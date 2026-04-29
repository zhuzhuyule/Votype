use crate::audio_toolkit::filter_transcription_output;
use crate::audio_toolkit::text::apply_custom_words;
use crate::managers::model::{EngineType, ModelManager};
use crate::settings::{get_settings, ModelUnloadTimeout};
use anyhow::Result;
use log::{debug, error, info, warn};
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use transcribe_rs::{
    onnx::{
        moonshine::{MoonshineModel, MoonshineVariant, StreamingModel},
        paraformer::ParaformerModel,
        parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity},
        sense_voice::{SenseVoiceModel, SenseVoiceParams},
        zipformer_ctc::ZipformerCtcModel,
        zipformer_transducer::ZipformerTransducerModel,
        Quantization,
    },
    whisper_cpp::{WhisperEngine, WhisperInferenceParams},
    SpeechModel, TranscribeOptions,
};

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

enum LoadedEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
    Moonshine(MoonshineModel),
    MoonshineStreaming(StreamingModel),
    SenseVoice(SenseVoiceModel),
    Paraformer(ParaformerModel),
    ZipformerTransducer(ZipformerTransducerModel),
    ZipformerCtc(ZipformerCtcModel),
}

fn is_sentence_ending_punctuation(ch: char) -> bool {
    matches!(ch, '。' | '！' | '？' | '!' | '?' | '.' | '…')
}

fn is_clause_punctuation(ch: char) -> bool {
    matches!(ch, '，' | '、' | '；' | '：' | ',' | ';' | ':')
}

fn is_wrapping_punctuation(ch: char) -> bool {
    matches!(
        ch,
        '"' | '\'' | ')' | ']' | '}' | '）' | '】' | '」' | '』' | '》' | '〉' | '”' | '’'
    )
}

fn ends_with_sentence_punctuation(text: &str) -> bool {
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return false;
    }

    for ch in trimmed.chars().rev() {
        if is_wrapping_punctuation(ch) {
            continue;
        }
        return is_sentence_ending_punctuation(ch);
    }

    false
}

fn should_skip_auto_punctuation(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    if ends_with_sentence_punctuation(trimmed) {
        return true;
    }

    let mut semantic_chars = 0usize;
    let mut sentence_endings = 0usize;
    let mut clause_marks = 0usize;

    for ch in trimmed.chars() {
        if ch.is_whitespace() || is_wrapping_punctuation(ch) {
            continue;
        }

        if is_sentence_ending_punctuation(ch) {
            sentence_endings += 1;
        } else if is_clause_punctuation(ch) {
            clause_marks += 1;
        } else {
            semantic_chars += 1;
        }
    }

    if sentence_endings >= 2 || (sentence_endings >= 1 && clause_marks >= 1) {
        return true;
    }

    // List-like or already segmented short content usually does not benefit from
    // another punctuation pass and is more likely to be over-processed.
    clause_marks >= 3 && semantic_chars <= 24
}

#[derive(Clone)]
pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<LoadedEngine>>>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
    punct_model: Arc<Mutex<Option<transcribe_rs::punct::PunctModel>>>,
    engine_in_use: Arc<AtomicBool>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

impl TranscriptionManager {
    pub fn touch_activity(&self) {
        self.last_activity.store(now_ms(), Ordering::Relaxed);
    }

    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(now_ms())),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
            punct_model: Arc::new(Mutex::new(None)),
            engine_in_use: Arc::new(AtomicBool::new(false)),
        };

        // Start the idle watcher
        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                while !shutdown_signal.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(10)); // Check every 10 seconds

                    // Check shutdown signal again after sleep
                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    let settings = get_settings(&app_handle_cloned);
                    let timeout_seconds = settings.model_unload_timeout.to_seconds();

                    if let Some(limit_seconds) = timeout_seconds {
                        // Skip polling-based unloading for immediate timeout since it's handled directly in transcribe()
                        if matches!(
                            settings.model_unload_timeout,
                            ModelUnloadTimeout::Immediately
                        ) {
                            continue;
                        }

                        // Keep model loaded while recording is active
                        let is_recording = app_handle_cloned
                            .try_state::<Arc<crate::managers::audio::AudioRecordingManager>>()
                            .map_or(false, |a| a.is_recording());
                        if is_recording {
                            manager_cloned.touch_activity();
                            continue;
                        }

                        let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                        let now_ms = now_ms();
                        let idle_ms = now_ms.saturating_sub(last);
                        let limit_ms = limit_seconds * 1000;

                        if idle_ms > limit_ms && manager_cloned.is_model_loaded() {
                            info!(
                                "Model idle for {}s (limit {}s), unloading",
                                idle_ms / 1000,
                                limit_ms / 1000
                            );
                            match manager_cloned.unload_model() {
                                Ok(()) => {
                                    let _ = app_handle_cloned.emit(
                                        "model-state-changed",
                                        ModelStateEvent {
                                            event_type: "unloaded".to_string(),
                                            model_id: None,
                                            model_name: None,
                                            error: None,
                                        },
                                    );
                                }
                                Err(e) => error!("Failed to unload idle model: {}", e),
                            }
                        }
                    }
                }
                debug!("Idle watcher thread shutting down gracefully");
            });
            *manager.watcher_handle.lock().unwrap() = Some(handle);
        }

        Ok(manager)
    }

    /// Lock the engine mutex, recovering from poison if a previous transcription panicked.
    fn lock_engine(&self) -> MutexGuard<'_, Option<LoadedEngine>> {
        self.engine.lock().unwrap_or_else(|poisoned| {
            warn!("Engine mutex was poisoned by a previous panic, recovering");
            poisoned.into_inner()
        })
    }

    pub fn is_model_loaded(&self) -> bool {
        let engine = self.lock_engine();
        engine.is_some()
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");

        {
            let mut engine = self.lock_engine();
            *engine = None; // Drop the engine to free memory
        }
        {
            let mut current_model = self.current_model_id.lock().unwrap();
            *current_model = None;
        }

        // Emit unloaded event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "unloaded".to_string(),
                model_id: None,
                model_name: None,
                error: None,
            },
        );

        let unload_duration = unload_start.elapsed();
        debug!(
            "Model unloaded manually (took {}ms)",
            unload_duration.as_millis()
        );
        Ok(())
    }

    /// Unloads the model immediately if the setting is enabled and the model is loaded
    pub fn maybe_unload_immediately(&self, context: &str) {
        let settings = get_settings(&self.app_handle);
        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately
            && self.is_model_loaded()
        {
            info!("Immediately unloading model after {}", context);
            if let Err(e) = self.unload_model() {
                warn!("Failed to immediately unload model: {}", e);
            }
        }
    }

    pub fn load_model(&self, model_id: &str) -> Result<()> {
        let load_start = std::time::Instant::now();
        debug!("Starting to load model: {}", model_id);

        // Emit loading started event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_started".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: None,
                error: None,
            },
        );

        let model_info = self
            .model_manager
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            let error_msg = "Model not downloaded";
            let _ = self.app_handle.emit(
                "model-state-changed",
                ModelStateEvent {
                    event_type: "loading_failed".to_string(),
                    model_id: Some(model_id.to_string()),
                    model_name: Some(model_info.name.clone()),
                    error: Some(error_msg.to_string()),
                },
            );
            return Err(anyhow::anyhow!(error_msg));
        }

        let model_path = self.model_manager.get_model_path(model_id)?;

        // Create appropriate engine based on model type
        let loaded_engine = match model_info.engine_type {
            EngineType::Whisper => {
                let engine = WhisperEngine::load(&model_path).map_err(|e| {
                    let error_msg = format!("Failed to load whisper model {}: {}", model_id, e);
                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "loading_failed".to_string(),
                            model_id: Some(model_id.to_string()),
                            model_name: Some(model_info.name.clone()),
                            error: Some(error_msg.clone()),
                        },
                    );
                    anyhow::anyhow!(error_msg)
                })?;
                LoadedEngine::Whisper(engine)
            }
            EngineType::Parakeet => {
                let engine =
                    ParakeetModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                        let error_msg =
                            format!("Failed to load parakeet model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::Parakeet(engine)
            }
            EngineType::Moonshine => {
                let engine =
                    MoonshineModel::load(&model_path, MoonshineVariant::Base, &Quantization::FP32)
                        .map_err(|e| {
                            let error_msg =
                                format!("Failed to load moonshine model {}: {}", model_id, e);
                            let _ = self.app_handle.emit(
                                "model-state-changed",
                                ModelStateEvent {
                                    event_type: "loading_failed".to_string(),
                                    model_id: Some(model_id.to_string()),
                                    model_name: Some(model_info.name.clone()),
                                    error: Some(error_msg.clone()),
                                },
                            );
                            anyhow::anyhow!(error_msg)
                        })?;
                LoadedEngine::Moonshine(engine)
            }
            EngineType::MoonshineStreaming => {
                let engine =
                    StreamingModel::load(&model_path, 4, &Quantization::FP32).map_err(|e| {
                        let error_msg = format!(
                            "Failed to load moonshine streaming model {}: {}",
                            model_id, e
                        );
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::MoonshineStreaming(engine)
            }
            EngineType::SenseVoice => {
                let engine =
                    SenseVoiceModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                        let error_msg =
                            format!("Failed to load SenseVoice model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::SenseVoice(engine)
            }
            EngineType::Paraformer => {
                let engine =
                    ParaformerModel::load(&model_path, &Quantization::FP32).map_err(|e| {
                        let error_msg =
                            format!("Failed to load Paraformer model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::Paraformer(engine)
            }
            EngineType::ZipformerTransducer => {
                let has_int8 = std::fs::read_dir(&model_path)
                    .map(|entries| {
                        entries.filter_map(|e| e.ok()).any(|e| {
                            let name = e.file_name().to_string_lossy().to_string();
                            name.starts_with("encoder")
                                && name.contains("int8")
                                && name.ends_with(".onnx")
                        })
                    })
                    .unwrap_or(false);
                let quantization = if has_int8 {
                    Quantization::Int8
                } else {
                    Quantization::FP32
                };
                let engine =
                    ZipformerTransducerModel::load(&model_path, &quantization).map_err(|e| {
                        let error_msg = format!(
                            "Failed to load Zipformer Transducer model {}: {}",
                            model_id, e
                        );
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::ZipformerTransducer(engine)
            }
            EngineType::ZipformerCtc => {
                let quantization = if model_path.join("model.int8.onnx").exists() {
                    Quantization::Int8
                } else {
                    Quantization::FP32
                };
                let engine = ZipformerCtcModel::load(&model_path, &quantization).map_err(|e| {
                    let error_msg =
                        format!("Failed to load Zipformer CTC model {}: {}", model_id, e);
                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "loading_failed".to_string(),
                            model_id: Some(model_id.to_string()),
                            model_name: Some(model_info.name.clone()),
                            error: Some(error_msg.clone()),
                        },
                    );
                    anyhow::anyhow!(error_msg)
                })?;
                LoadedEngine::ZipformerCtc(engine)
            }
        };

        // Update the current engine and model ID
        {
            let mut engine = self.lock_engine();
            *engine = Some(loaded_engine);
        }
        {
            let mut current_model = self.current_model_id.lock().unwrap();
            *current_model = Some(model_id.to_string());
        }

        // Emit loading completed event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_completed".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: Some(model_info.name.clone()),
                error: None,
            },
        );

        self.touch_activity();

        let load_duration = load_start.elapsed();
        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_duration.as_millis()
        );
        Ok(())
    }

    /// Kicks off the model loading in a background thread if the correct model isn't already loaded
    pub fn initiate_model_load(&self) {
        let settings = get_settings(&self.app_handle);
        self.initiate_model_load_for(&settings.selected_model);
    }

    /// Like `initiate_model_load`, but targets a specific model id (e.g. the
    /// secondary local model used for realtime preview while online ASR is primary).
    pub fn initiate_model_load_for(&self, desired_model: &str) {
        if desired_model.trim().is_empty() {
            log::warn!(
                "[TranscriptionManager] initiate_model_load_for called with empty model id — skipping"
            );
            return;
        }

        let mut is_loading = self.is_loading.lock().unwrap();
        if *is_loading {
            return;
        }

        if let Some(ref current) = *self.current_model_id.lock().unwrap() {
            if current == desired_model {
                return;
            }
            debug!(
                "Loaded model '{}' differs from desired '{}', reloading",
                current, desired_model
            );
        }

        *is_loading = true;
        let self_clone = self.clone();
        let desired_model = desired_model.to_string();
        thread::spawn(move || {
            log::info!(
                "[TranscriptionManager] loading local model '{}'",
                desired_model
            );
            if let Err(e) = self_clone.load_model(&desired_model) {
                error!("Failed to load local model '{}': {}", desired_model, e);
            }
            let mut is_loading = self_clone.is_loading.lock().unwrap();
            *is_loading = false;
            self_clone.loading_condvar.notify_all();
        });
    }

    pub fn get_current_model(&self) -> Option<String> {
        let current_model = self.current_model_id.lock().unwrap();
        current_model.clone()
    }

    pub fn transcribe(&self, audio: Vec<f32>) -> Result<String> {
        // Update last activity timestamp
        self.touch_activity();

        let st = std::time::Instant::now();

        debug!("Audio vector length: {}", audio.len());

        if audio.is_empty() {
            debug!("Empty audio vector");
            self.maybe_unload_immediately("empty audio");
            return Ok(String::new());
        }

        // Wait for realtime worker to release the engine if it's mid-transcription.
        // This avoids a race where stop() drops the speech-frame sender and spawns
        // the final transcription while the realtime worker still holds the engine.
        {
            let wait_start = std::time::Instant::now();
            while self.engine_in_use.load(Ordering::Acquire) {
                if wait_start.elapsed() > Duration::from_secs(5) {
                    return Err(anyhow::anyhow!(
                        "Timeout waiting for engine (realtime worker did not release)."
                    ));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }

        // Check if model is loaded
        {
            // If the model is loading, wait for it to complete.
            let mut is_loading = self.is_loading.lock().unwrap();
            while *is_loading {
                is_loading = self.loading_condvar.wait(is_loading).unwrap();
            }

            let engine_guard = self.lock_engine();
            if engine_guard.is_none() {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        }

        // Get current settings for configuration
        let settings = get_settings(&self.app_handle);

        // Perform transcription with the appropriate engine.
        // We use catch_unwind to prevent engine panics from poisoning the mutex,
        // which would make the app hang indefinitely on subsequent operations.
        let result = {
            let mut engine_guard = self.lock_engine();

            // Take the engine out so we own it during transcription.
            // If the engine panics, we simply don't put it back (effectively unloading it)
            // instead of poisoning the mutex.
            let mut engine = match engine_guard.take() {
                Some(e) => e,
                None => {
                    return Err(anyhow::anyhow!("Model is not loaded for transcription."));
                }
            };
            self.engine_in_use.store(true, Ordering::Release);

            // Release the lock before transcribing — no mutex held during the engine call
            drop(engine_guard);

            let transcribe_result = catch_unwind(AssertUnwindSafe(
                || -> Result<transcribe_rs::TranscriptionResult> {
                    match &mut engine {
                        LoadedEngine::Whisper(whisper_engine) => {
                            let whisper_language = if settings.selected_language == "auto" {
                                None
                            } else {
                                let normalized = if settings.selected_language == "zh-Hans"
                                    || settings.selected_language == "zh-Hant"
                                {
                                    "zh".to_string()
                                } else {
                                    settings.selected_language.clone()
                                };
                                Some(normalized)
                            };

                            let params = WhisperInferenceParams {
                                language: whisper_language,
                                translate: settings.translate_to_english,
                                initial_prompt: if settings.custom_words.is_empty() {
                                    None
                                } else {
                                    Some(settings.custom_words.join(", "))
                                },
                                ..Default::default()
                            };

                            whisper_engine
                                .transcribe_with(&audio, &params)
                                .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))
                        }
                        LoadedEngine::Parakeet(parakeet_engine) => {
                            let params = ParakeetParams {
                                timestamp_granularity: Some(TimestampGranularity::Segment),
                                ..Default::default()
                            };
                            parakeet_engine
                                .transcribe_with(&audio, &params)
                                .map_err(|e| {
                                    anyhow::anyhow!("Parakeet transcription failed: {}", e)
                                })
                        }
                        LoadedEngine::Moonshine(moonshine_engine) => moonshine_engine
                            .transcribe(&audio, &TranscribeOptions::default())
                            .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e)),
                        LoadedEngine::MoonshineStreaming(streaming_engine) => streaming_engine
                            .transcribe(&audio, &TranscribeOptions::default())
                            .map_err(|e| {
                                anyhow::anyhow!("Moonshine streaming transcription failed: {}", e)
                            }),
                        LoadedEngine::SenseVoice(sense_voice_engine) => {
                            let language = match settings.selected_language.as_str() {
                                "zh" | "zh-Hans" | "zh-Hant" => Some("zh".to_string()),
                                "en" => Some("en".to_string()),
                                "ja" => Some("ja".to_string()),
                                "ko" => Some("ko".to_string()),
                                "yue" => Some("yue".to_string()),
                                _ => None,
                            };
                            let params = SenseVoiceParams {
                                language,
                                use_itn: Some(true),
                            };
                            sense_voice_engine
                                .transcribe_with(&audio, &params)
                                .map_err(|e| {
                                    anyhow::anyhow!("SenseVoice transcription failed: {}", e)
                                })
                        }
                        LoadedEngine::Paraformer(paraformer_engine) => paraformer_engine
                            .transcribe(&audio, &TranscribeOptions::default())
                            .map_err(|e| anyhow::anyhow!("Paraformer transcription failed: {}", e)),
                        LoadedEngine::ZipformerTransducer(zipformer_engine) => zipformer_engine
                            .transcribe(&audio, &TranscribeOptions::default())
                            .map_err(|e| {
                                anyhow::anyhow!("Zipformer Transducer transcription failed: {}", e)
                            }),
                        LoadedEngine::ZipformerCtc(zipformer_engine) => zipformer_engine
                            .transcribe(&audio, &TranscribeOptions::default())
                            .map_err(|e| {
                                anyhow::anyhow!("Zipformer CTC transcription failed: {}", e)
                            }),
                    }
                },
            ));

            match transcribe_result {
                Ok(inner_result) => {
                    // Success or normal error — put the engine back
                    self.engine_in_use.store(false, Ordering::Release);
                    let mut engine_guard = self.lock_engine();
                    *engine_guard = Some(engine);
                    inner_result?
                }
                Err(panic_payload) => {
                    self.engine_in_use.store(false, Ordering::Release);
                    // Engine panicked — do NOT put it back (it's in an unknown state).
                    // The engine is dropped here, effectively unloading it.
                    let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    error!(
                        "Transcription engine panicked: {}. Model has been unloaded.",
                        panic_msg
                    );

                    // Clear the model ID so it will be reloaded on next attempt
                    {
                        let mut current_model = self
                            .current_model_id
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        *current_model = None;
                    }

                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "unloaded".to_string(),
                            model_id: None,
                            model_name: None,
                            error: Some(format!("Engine panicked: {}", panic_msg)),
                        },
                    );

                    return Err(anyhow::anyhow!(
                        "Transcription engine panicked: {}. The model has been unloaded and will reload on next attempt.",
                        panic_msg
                    ));
                }
            }
        };

        // Apply hotword force replacements on the raw engine output BEFORE any
        // downstream text processing. This keeps the invariant: whatever the
        // ASR produced, force-replace runs first so custom_words matching,
        // filler filtering, punctuation, history persistence, and post-process
        // all see the already-substituted text.
        let raw_text = crate::managers::hotword::apply_force_replacements_via_state(
            &self.app_handle,
            result.text,
        );

        // Apply word correction if custom words are configured.
        // Skip for Whisper models since custom words are already passed as initial_prompt.
        let is_whisper = self
            .model_manager
            .get_model_info(&settings.selected_model)
            .map(|info| matches!(info.engine_type, EngineType::Whisper))
            .unwrap_or(false);

        let corrected_result = if !settings.custom_words.is_empty() && !is_whisper {
            apply_custom_words(
                &raw_text,
                &settings.custom_words,
                settings.word_correction_threshold,
            )
        } else {
            raw_text
        };

        // Filter out filler words and hallucinations
        let filtered_result = filter_transcription_output(
            &corrected_result,
            &settings.app_language,
            &settings.custom_filler_words,
        );

        // Punctuation post-processing: when enabled, always apply the CT-Transformer
        // punct model to format the text with proper punctuation. The user controls this
        // via a toggle — turning it on forces re-punctuation regardless of whether the
        // engine already produced punctuation.
        let final_result = if settings.punctuation_enabled && !filtered_result.trim().is_empty() {
            if should_skip_auto_punctuation(&filtered_result) {
                debug!(
                    "Skipping auto-punctuation because transcript already looks punctuated: {}",
                    filtered_result
                );
                filtered_result
            } else {
                let punct_model_id = &settings.punctuation_model;
                if !punct_model_id.is_empty() {
                    if let Some(model_info) = self.model_manager.get_model_info(punct_model_id) {
                        if model_info.is_downloaded {
                            match self.model_manager.get_model_path(punct_model_id) {
                                Ok(model_dir) => {
                                    let mut punct_guard =
                                        self.punct_model.lock().unwrap_or_else(|e| e.into_inner());
                                    if punct_guard.is_none() {
                                        info!(
                                            "Loading punctuation model '{}' (first use)...",
                                            punct_model_id
                                        );
                                        match transcribe_rs::punct::PunctModel::new(&model_dir) {
                                            Ok(model) => {
                                                *punct_guard = Some(model);
                                            }
                                            Err(e) => {
                                                warn!("Failed to load punctuation model: {}", e);
                                            }
                                        }
                                    }
                                    if let Some(ref mut punct) = *punct_guard {
                                        let punctuated = punct.add_punctuation(&filtered_result);
                                        if punctuated != filtered_result {
                                            info!(
                                                "Auto-punctuation applied: [{}] -> [{}]",
                                                filtered_result, punctuated
                                            );
                                        }
                                        punctuated
                                    } else {
                                        filtered_result
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to locate punctuation model directory: {}", e);
                                    filtered_result
                                }
                            }
                        } else {
                            filtered_result
                        }
                    } else {
                        filtered_result
                    }
                } else {
                    filtered_result
                }
            }
        } else {
            filtered_result
        };

        let et = std::time::Instant::now();
        let translation_note = if settings.translate_to_english {
            " (translated)"
        } else {
            ""
        };
        if crate::DEBUG_LOG_TRANSCRIPTION.load(std::sync::atomic::Ordering::Relaxed) {
            info!(
                "Transcription completed in {}ms{}",
                (et - st).as_millis(),
                translation_note
            );

            if final_result.is_empty() {
                info!("Transcription result is empty");
            } else {
                let preview: String = final_result.chars().take(100).collect();
                let suffix = if final_result.chars().count() > 100 {
                    "…"
                } else {
                    ""
                };
                info!(
                    "Transcription result (len={}): {}{}",
                    final_result.chars().count(),
                    preview,
                    suffix
                );
            }
        }

        self.maybe_unload_immediately("transcription");

        Ok(final_result)
    }

    /// Try to apply punctuation non-blockingly. Returns `None` if model not loaded or busy.
    pub fn try_add_punctuation(&self, text: &str) -> Option<String> {
        let settings = get_settings(&self.app_handle);
        if !settings.punctuation_enabled {
            return None;
        }
        if should_skip_auto_punctuation(text) {
            return Some(text.to_string());
        }
        if let Ok(mut guard) = self.punct_model.try_lock() {
            if let Some(ref mut punct) = *guard {
                return Some(punct.add_punctuation(text));
            }
        }
        None
    }

    /// Pre-load the punctuation model so it's ready when needed.
    pub fn ensure_punct_model_loaded(&self) {
        let settings = get_settings(&self.app_handle);
        if !settings.punctuation_enabled {
            return;
        }
        let punct_model_id = &settings.punctuation_model;
        if punct_model_id.is_empty() {
            return;
        }
        let model_info = match self.model_manager.get_model_info(punct_model_id) {
            Some(info) if info.is_downloaded => info,
            _ => return,
        };
        let model_dir = match self.model_manager.get_model_path(punct_model_id) {
            Ok(dir) => dir,
            Err(_) => return,
        };
        let mut punct_guard = self.punct_model.lock().unwrap_or_else(|e| e.into_inner());
        if punct_guard.is_some() {
            return;
        }
        info!("Pre-loading punctuation model for realtime preview...");
        match transcribe_rs::punct::PunctModel::new(&model_dir) {
            Ok(model) => {
                *punct_guard = Some(model);
                info!(
                    "Punctuation model '{}' pre-loaded successfully",
                    model_info.name
                );
            }
            Err(e) => {
                warn!("Failed to pre-load punctuation model: {}", e);
            }
        }
    }

    /// Non-blocking transcription for realtime preview.
    /// Returns `None` immediately if the engine is busy, not loaded, or audio is empty.
    /// Does not wait for model loading, update last_activity, or trigger auto-unload.
    pub fn try_transcribe_raw(&self, audio: Vec<f32>) -> Option<String> {
        if audio.is_empty() {
            return None;
        }
        if self.engine_in_use.load(Ordering::Acquire) {
            return None;
        }

        let mut engine_guard = self.engine.try_lock().ok()?;
        let mut engine = engine_guard.take()?;
        self.engine_in_use.store(true, Ordering::Release);
        drop(engine_guard);

        let result = catch_unwind(AssertUnwindSafe(
            || -> Result<transcribe_rs::TranscriptionResult> {
                let opts = TranscribeOptions::default();
                match &mut engine {
                    LoadedEngine::Whisper(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("Whisper realtime failed: {}", e)),
                    LoadedEngine::Parakeet(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("Parakeet realtime failed: {}", e)),
                    LoadedEngine::Moonshine(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("Moonshine realtime failed: {}", e)),
                    LoadedEngine::MoonshineStreaming(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("MoonshineStreaming realtime failed: {}", e)),
                    LoadedEngine::SenseVoice(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("SenseVoice realtime failed: {}", e)),
                    LoadedEngine::Paraformer(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("Paraformer realtime failed: {}", e)),
                    LoadedEngine::ZipformerTransducer(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("ZipformerTransducer realtime failed: {}", e)),
                    LoadedEngine::ZipformerCtc(e) => e
                        .transcribe(&audio, &opts)
                        .map_err(|e| anyhow::anyhow!("ZipformerCtc realtime failed: {}", e)),
                }
            },
        ));

        self.engine_in_use.store(false, Ordering::Release);

        match result {
            Ok(Ok(transcription)) => {
                let mut guard = self.lock_engine();
                *guard = Some(engine);
                let text = transcription.text.trim().to_string();
                if text.is_empty() {
                    None
                } else {
                    Some(text)
                }
            }
            Ok(Err(e)) => {
                warn!("Realtime transcription error: {}", e);
                // Put engine back even on transcription error (engine state is fine)
                let mut guard = self.lock_engine();
                *guard = Some(engine);
                None
            }
            Err(_) => {
                // Engine panicked — don't put it back
                warn!("Realtime transcription engine panicked, engine dropped");
                None
            }
        }
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        // Only shut down if this is the last clone
        if Arc::strong_count(&self.shutdown_signal) > 1 {
            return;
        }

        debug!("Shutting down TranscriptionManager");

        // Signal the watcher thread to shutdown
        self.shutdown_signal.store(true, Ordering::Relaxed);

        // Wait for the thread to finish gracefully
        if let Some(handle) = self.watcher_handle.lock().unwrap().take() {
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            } else {
                debug!("Idle watcher thread joined successfully");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Accelerator / GPU device settings
// ---------------------------------------------------------------------------

/// Apply the user's accelerator preferences to the transcribe-rs global atomics.
/// Called on startup and whenever the user changes the setting.
pub fn apply_accelerator_settings(app: &tauri::AppHandle) {
    use transcribe_rs::accel;

    let settings = get_settings(app);

    let whisper_pref = match settings.whisper_accelerator {
        crate::settings::WhisperAcceleratorSetting::Auto => accel::WhisperAccelerator::Auto,
        crate::settings::WhisperAcceleratorSetting::Cpu => accel::WhisperAccelerator::CpuOnly,
        crate::settings::WhisperAcceleratorSetting::Gpu => accel::WhisperAccelerator::Gpu,
    };
    accel::set_whisper_accelerator(whisper_pref);
    accel::set_whisper_gpu_device(settings.whisper_gpu_device);
    info!(
        "Whisper accelerator set to: {:?}, gpu_device: {}",
        settings.whisper_accelerator,
        if settings.whisper_gpu_device == -1 {
            "auto".to_string()
        } else {
            settings.whisper_gpu_device.to_string()
        }
    );

    let ort_pref = match settings.ort_accelerator {
        crate::settings::OrtAcceleratorSetting::Auto => accel::OrtAccelerator::Auto,
        crate::settings::OrtAcceleratorSetting::Cpu => accel::OrtAccelerator::CpuOnly,
        crate::settings::OrtAcceleratorSetting::Cuda => accel::OrtAccelerator::Cuda,
        crate::settings::OrtAcceleratorSetting::DirectMl => accel::OrtAccelerator::DirectMl,
        crate::settings::OrtAcceleratorSetting::Rocm => accel::OrtAccelerator::Rocm,
    };
    accel::set_ort_accelerator(ort_pref);
    info!("ORT accelerator set to: {:?}", settings.ort_accelerator);
}

#[derive(Serialize, Clone, Debug, specta::Type)]
pub struct GpuDeviceOption {
    pub id: i32,
    pub name: String,
    pub total_vram_mb: usize,
}

static GPU_DEVICES: std::sync::OnceLock<Vec<GpuDeviceOption>> = std::sync::OnceLock::new();

fn cached_gpu_devices() -> &'static [GpuDeviceOption] {
    GPU_DEVICES.get_or_init(|| {
        use transcribe_rs::whisper_cpp::gpu::list_gpu_devices;
        list_gpu_devices()
            .into_iter()
            .map(|d| GpuDeviceOption {
                id: d.id,
                name: d.name,
                total_vram_mb: d.total_vram / (1024 * 1024),
            })
            .collect()
    })
}

#[derive(Serialize, Clone, Debug, specta::Type)]
pub struct AvailableAccelerators {
    pub whisper: Vec<String>,
    pub ort: Vec<String>,
    pub gpu_devices: Vec<GpuDeviceOption>,
}

/// Return which accelerators are compiled into this build.
pub fn get_available_accelerators() -> AvailableAccelerators {
    use transcribe_rs::accel::OrtAccelerator;

    let ort_options: Vec<String> = OrtAccelerator::available()
        .into_iter()
        .map(|a| a.to_string())
        .collect();

    let whisper_options = vec!["auto".to_string(), "cpu".to_string(), "gpu".to_string()];

    AvailableAccelerators {
        whisper: whisper_options,
        ort: ort_options,
        gpu_devices: cached_gpu_devices().to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::{ends_with_sentence_punctuation, should_skip_auto_punctuation};

    #[test]
    fn detects_sentence_end_even_with_closing_quotes() {
        assert!(ends_with_sentence_punctuation("你好。"));
        assert!(ends_with_sentence_punctuation("你好。\""));
        assert!(ends_with_sentence_punctuation("你好。）」"));
    }

    #[test]
    fn skips_when_text_already_ends_cleanly() {
        assert!(should_skip_auto_punctuation("今天天气不错。"));
        assert!(should_skip_auto_punctuation("Hello, world."));
        assert!(should_skip_auto_punctuation("可以开始了吗？"));
    }

    #[test]
    fn skips_when_internal_punctuation_is_already_natural() {
        assert!(should_skip_auto_punctuation("你好，世界。欢迎使用。"));
        assert!(should_skip_auto_punctuation(
            "第一点：买菜；第二点：做饭；第三点：洗碗"
        ));
    }

    #[test]
    fn keeps_unpunctuated_text_eligible_for_model_processing() {
        assert!(!should_skip_auto_punctuation("今天天气不错我们出去走走"));
        assert!(!should_skip_auto_punctuation("hello world this is a test"));
        assert!(!should_skip_auto_punctuation("你好，今天怎么样"));
    }
}
