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
use tauri::{AppHandle, Emitter};
use transcribe_rs::{
    engines::{
        moonshine::{
            ModelVariant, MoonshineEngine, MoonshineModelParams, MoonshineStreamingEngine,
            StreamingModelParams,
        },
        paraformer::{ParaformerEngine, ParaformerModelParams},
        parakeet::{
            ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
        },
        sense_voice::{
            Language as SenseVoiceLanguage, SenseVoiceEngine, SenseVoiceInferenceParams,
            SenseVoiceModelParams,
        },
        whisper::{WhisperEngine, WhisperInferenceParams},
        zipformer_ctc::{ZipformerCtcEngine, ZipformerCtcModelParams},
        zipformer_transducer::{ZipformerTransducerEngine, ZipformerTransducerModelParams},
    },
    TranscriptionEngine,
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
    Parakeet(ParakeetEngine),
    Moonshine(MoonshineEngine),
    MoonshineStreaming(MoonshineStreamingEngine),
    SenseVoice(SenseVoiceEngine),
    Paraformer(ParaformerEngine),
    ZipformerTransducer(ZipformerTransducerEngine),
    ZipformerCtc(ZipformerCtcEngine),
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

impl TranscriptionManager {
    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
            )),
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
                        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
                            continue;
                        }

                        let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                        let now_ms = SystemTime::now()
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;

                        if now_ms.saturating_sub(last) > limit_seconds * 1000 {
                            // idle -> unload
                            if manager_cloned.is_model_loaded() {
                                let unload_start = std::time::Instant::now();
                                debug!("Starting to unload model due to inactivity");

                                if let Ok(()) = manager_cloned.unload_model() {
                                    let _ = app_handle_cloned.emit(
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
                                        "Model unloaded due to inactivity (took {}ms)",
                                        unload_duration.as_millis()
                                    );
                                }
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
            if let Some(ref mut loaded_engine) = *engine {
                match loaded_engine {
                    LoadedEngine::Whisper(ref mut e) => e.unload_model(),
                    LoadedEngine::Parakeet(ref mut e) => e.unload_model(),
                    LoadedEngine::Moonshine(ref mut e) => e.unload_model(),
                    LoadedEngine::MoonshineStreaming(ref mut e) => e.unload_model(),
                    LoadedEngine::SenseVoice(ref mut e) => e.unload_model(),
                    LoadedEngine::Paraformer(ref mut e) => e.unload_model(),
                    LoadedEngine::ZipformerTransducer(ref mut e) => e.unload_model(),
                    LoadedEngine::ZipformerCtc(ref mut e) => e.unload_model(),
                }
            }
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
                let mut engine = WhisperEngine::new();
                engine.load_model(&model_path).map_err(|e| {
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
                let mut engine = ParakeetEngine::new();
                engine
                    .load_model_with_params(&model_path, ParakeetModelParams::int8())
                    .map_err(|e| {
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
                let mut engine = MoonshineEngine::new();
                engine
                    .load_model_with_params(
                        &model_path,
                        MoonshineModelParams::variant(ModelVariant::Base),
                    )
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
                let mut engine = MoonshineStreamingEngine::new();
                engine
                    .load_model_with_params(&model_path, StreamingModelParams::default())
                    .map_err(|e| {
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
                let mut engine = SenseVoiceEngine::new();
                engine
                    .load_model_with_params(&model_path, SenseVoiceModelParams::int8())
                    .map_err(|e| {
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
                let mut engine = ParaformerEngine::new();
                engine
                    .load_model_with_params(&model_path, ParaformerModelParams::default())
                    .map_err(|e| {
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
                let mut engine = ZipformerTransducerEngine::new();
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
                let params = if has_int8 {
                    ZipformerTransducerModelParams::int8()
                } else {
                    ZipformerTransducerModelParams::fp32()
                };
                engine
                    .load_model_with_params(&model_path, params)
                    .map_err(|e| {
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
                let mut engine = ZipformerCtcEngine::new();
                let params = if model_path.join("model.int8.onnx").exists() {
                    ZipformerCtcModelParams::int8()
                } else {
                    ZipformerCtcModelParams::default()
                };
                engine
                    .load_model_with_params(&model_path, params)
                    .map_err(|e| {
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

        let load_duration = load_start.elapsed();
        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_duration.as_millis()
        );
        Ok(())
    }

    /// Kicks off the model loading in a background thread if it's not already loaded
    pub fn initiate_model_load(&self) {
        let mut is_loading = self.is_loading.lock().unwrap();
        if *is_loading || self.is_model_loaded() {
            return;
        }

        *is_loading = true;
        let self_clone = self.clone();
        thread::spawn(move || {
            let settings = get_settings(&self_clone.app_handle);
            if let Err(e) = self_clone.load_model(&settings.selected_model) {
                error!("Failed to load model: {}", e);
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
        self.last_activity.store(
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            Ordering::Relaxed,
        );

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
                                ..Default::default()
                            };

                            whisper_engine
                                .transcribe_samples(audio, Some(params))
                                .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))
                        }
                        LoadedEngine::Parakeet(parakeet_engine) => {
                            let params = ParakeetInferenceParams {
                                timestamp_granularity: TimestampGranularity::Segment,
                                ..Default::default()
                            };
                            parakeet_engine
                                .transcribe_samples(audio, Some(params))
                                .map_err(|e| {
                                    anyhow::anyhow!("Parakeet transcription failed: {}", e)
                                })
                        }
                        LoadedEngine::Moonshine(moonshine_engine) => moonshine_engine
                            .transcribe_samples(audio, None)
                            .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e)),
                        LoadedEngine::MoonshineStreaming(streaming_engine) => streaming_engine
                            .transcribe_samples(audio, None)
                            .map_err(|e| {
                                anyhow::anyhow!("Moonshine streaming transcription failed: {}", e)
                            }),
                        LoadedEngine::SenseVoice(sense_voice_engine) => {
                            let language = match settings.selected_language.as_str() {
                                "zh" | "zh-Hans" | "zh-Hant" => SenseVoiceLanguage::Chinese,
                                "en" => SenseVoiceLanguage::English,
                                "ja" => SenseVoiceLanguage::Japanese,
                                "ko" => SenseVoiceLanguage::Korean,
                                "yue" => SenseVoiceLanguage::Cantonese,
                                _ => SenseVoiceLanguage::Auto,
                            };
                            let params = SenseVoiceInferenceParams {
                                language,
                                use_itn: true,
                            };
                            sense_voice_engine
                                .transcribe_samples(audio, Some(params))
                                .map_err(|e| {
                                    anyhow::anyhow!("SenseVoice transcription failed: {}", e)
                                })
                        }
                        LoadedEngine::Paraformer(paraformer_engine) => paraformer_engine
                            .transcribe_samples(audio, None)
                            .map_err(|e| anyhow::anyhow!("Paraformer transcription failed: {}", e)),
                        LoadedEngine::ZipformerTransducer(zipformer_engine) => zipformer_engine
                            .transcribe_samples(audio, None)
                            .map_err(|e| {
                                anyhow::anyhow!("Zipformer Transducer transcription failed: {}", e)
                            }),
                        LoadedEngine::ZipformerCtc(zipformer_engine) => zipformer_engine
                            .transcribe_samples(audio, None)
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

        // Apply word correction if custom words are configured
        let corrected_result = if !settings.custom_words.is_empty() {
            apply_custom_words(
                &result.text,
                &settings.custom_words,
                settings.word_correction_threshold,
            )
        } else {
            result.text
        };

        // Filter out filler words and hallucinations
        let filtered_result = filter_transcription_output(&corrected_result);

        // Punctuation post-processing: when enabled, always apply the CT-Transformer
        // punct model to format the text with proper punctuation. The user controls this
        // via a toggle — turning it on forces re-punctuation regardless of whether the
        // engine already produced punctuation.
        let final_result = if settings.punctuation_enabled && !filtered_result.trim().is_empty() {
            let punct_model_id = &settings.punctuation_model;
            if !punct_model_id.is_empty() {
                if let Some(model_info) = self.model_manager.get_model_info(punct_model_id) {
                    if model_info.is_downloaded {
                        match self.model_manager.get_model_path(punct_model_id) {
                            Ok(model_dir) => {
                                let mut punct_guard =
                                    self.punct_model.lock().unwrap_or_else(|e| e.into_inner());
                                if punct_guard.is_none() {
                                    info!("Loading punctuation model (first use)...");
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
        } else {
            filtered_result
        };

        let et = std::time::Instant::now();
        let translation_note = if settings.translate_to_english {
            " (translated)"
        } else {
            ""
        };
        info!(
            "Transcription completed in {}ms{}",
            (et - st).as_millis(),
            translation_note
        );

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            info!("Transcription result: {}", final_result);
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
                match &mut engine {
                    LoadedEngine::Whisper(e) => e
                        .transcribe_samples(audio, None)
                        .map_err(|e| anyhow::anyhow!("Whisper realtime failed: {}", e)),
                    LoadedEngine::Parakeet(e) => e
                        .transcribe_samples(audio, None)
                        .map_err(|e| anyhow::anyhow!("Parakeet realtime failed: {}", e)),
                    LoadedEngine::Moonshine(e) => e
                        .transcribe_samples(audio, None)
                        .map_err(|e| anyhow::anyhow!("Moonshine realtime failed: {}", e)),
                    LoadedEngine::MoonshineStreaming(e) => e
                        .transcribe_samples(audio, None)
                        .map_err(|e| anyhow::anyhow!("MoonshineStreaming realtime failed: {}", e)),
                    LoadedEngine::SenseVoice(e) => e
                        .transcribe_samples(audio, None)
                        .map_err(|e| anyhow::anyhow!("SenseVoice realtime failed: {}", e)),
                    LoadedEngine::Paraformer(e) => e
                        .transcribe_samples(audio, None)
                        .map_err(|e| anyhow::anyhow!("Paraformer realtime failed: {}", e)),
                    LoadedEngine::ZipformerTransducer(e) => e
                        .transcribe_samples(audio, None)
                        .map_err(|e| anyhow::anyhow!("ZipformerTransducer realtime failed: {}", e)),
                    LoadedEngine::ZipformerCtc(e) => e
                        .transcribe_samples(audio, None)
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
