use crate::audio_toolkit::apply_custom_words;
use crate::managers::model::{EngineType, ModelManager};
use crate::online_asr::{OnlineAsrClient, OnlineAsrStatusEvent};
use crate::settings::{get_settings, ModelUnloadTimeout};
use anyhow::Result;
use log::{debug, error, info, warn};
use serde::Serialize;
use std::ffi::{CStr, CString};
use std::mem;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use transcribe_rs::{
    engines::{
        parakeet::{
            ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
        },
        whisper::{WhisperEngine, WhisperInferenceParams},
    },
    TranscriptionEngine,
};

struct SherpaStreamingZipformer {
    recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
    _encoder: CString,
    _decoder: CString,
    _joiner: CString,
    _tokens: CString,
    _provider: CString,
    _decoding_method: CString,
}

impl SherpaStreamingZipformer {
    fn new(
        encoder: String,
        decoder: String,
        joiner: String,
        tokens: String,
        provider: String,
        num_threads: i32,
        debug: bool,
    ) -> Result<Self> {
        let encoder = CString::new(encoder)?;
        let decoder = CString::new(decoder)?;
        let joiner = CString::new(joiner)?;
        let tokens = CString::new(tokens)?;
        let provider = CString::new(provider)?;
        let decoding_method = CString::new("greedy_search")?;

        let mut online_model_config: sherpa_rs_sys::SherpaOnnxOnlineModelConfig =
            unsafe { mem::zeroed() };
        online_model_config.debug = debug.into();
        online_model_config.num_threads = num_threads;
        online_model_config.provider = provider.as_ptr();
        online_model_config.tokens = tokens.as_ptr();
        online_model_config.transducer = sherpa_rs_sys::SherpaOnnxOnlineTransducerModelConfig {
            encoder: encoder.as_ptr(),
            decoder: decoder.as_ptr(),
            joiner: joiner.as_ptr(),
        };

        let mut recognizer_config: sherpa_rs_sys::SherpaOnnxOnlineRecognizerConfig =
            unsafe { mem::zeroed() };
        recognizer_config.decoding_method = decoding_method.as_ptr();
        recognizer_config.feat_config = sherpa_rs_sys::SherpaOnnxFeatureConfig {
            sample_rate: 16000,
            feature_dim: 80,
        };
        recognizer_config.model_config = online_model_config;

        let recognizer =
            unsafe { sherpa_rs_sys::SherpaOnnxCreateOnlineRecognizer(&recognizer_config) };
        if recognizer.is_null() {
            return Err(anyhow::anyhow!("Failed to create Sherpa streaming recognizer"));
        }

        Ok(Self {
            recognizer,
            _encoder: encoder,
            _decoder: decoder,
            _joiner: joiner,
            _tokens: tokens,
            _provider: provider,
            _decoding_method: decoding_method,
        })
    }

    fn decode(&self, sample_rate: i32, samples: &[f32]) -> Result<String> {
        if samples.is_empty() {
            return Ok(String::new());
        }

        let stream = unsafe { sherpa_rs_sys::SherpaOnnxCreateOnlineStream(self.recognizer) };
        if stream.is_null() {
            return Err(anyhow::anyhow!("Failed to create Sherpa online stream"));
        }

        // Feed audio in small chunks to match streaming usage.
        const CHUNK_SAMPLES: usize = 3200; // 0.2s at 16kHz
        let mut offset = 0usize;
        while offset < samples.len() {
            let end = (offset + CHUNK_SAMPLES).min(samples.len());
            unsafe {
                sherpa_rs_sys::SherpaOnnxOnlineStreamAcceptWaveform(
                    stream,
                    sample_rate,
                    samples[offset..end].as_ptr(),
                    (end - offset) as i32,
                );
                while sherpa_rs_sys::SherpaOnnxIsOnlineStreamReady(self.recognizer, stream) == 1 {
                    sherpa_rs_sys::SherpaOnnxDecodeOnlineStream(self.recognizer, stream);
                }
            }
            offset = end;
        }

        // Add some tail paddings to flush the final tokens.
        let tail_len = (sample_rate as usize * 3) / 10; // 0.3 seconds
        let tail = vec![0.0f32; tail_len];
        unsafe {
            sherpa_rs_sys::SherpaOnnxOnlineStreamAcceptWaveform(
                stream,
                sample_rate,
                tail.as_ptr(),
                tail.len() as i32,
            );
            sherpa_rs_sys::SherpaOnnxOnlineStreamInputFinished(stream);
            while sherpa_rs_sys::SherpaOnnxIsOnlineStreamReady(self.recognizer, stream) == 1 {
                sherpa_rs_sys::SherpaOnnxDecodeOnlineStream(self.recognizer, stream);
            }
        }

        let result_ptr =
            unsafe { sherpa_rs_sys::SherpaOnnxGetOnlineStreamResult(self.recognizer, stream) };
        let text = if result_ptr.is_null() {
            String::new()
        } else {
            let raw_text = unsafe { (*result_ptr).text };
            if raw_text.is_null() {
                String::new()
            } else {
                unsafe { CStr::from_ptr(raw_text) }
                    .to_string_lossy()
                    .trim()
                    .to_string()
            }
        };

        unsafe {
            if !result_ptr.is_null() {
                sherpa_rs_sys::SherpaOnnxDestroyOnlineRecognizerResult(result_ptr);
            }
            sherpa_rs_sys::SherpaOnnxDestroyOnlineStream(stream);
        }

        Ok(text)
    }
}

unsafe impl Send for SherpaStreamingZipformer {}
unsafe impl Sync for SherpaStreamingZipformer {}

impl Drop for SherpaStreamingZipformer {
    fn drop(&mut self) {
        unsafe {
            sherpa_rs_sys::SherpaOnnxDestroyOnlineRecognizer(self.recognizer);
        }
    }
}

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
    Sherpa(SherpaStreamingZipformer),
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

    pub fn is_model_loaded(&self) -> bool {
        let engine = self.engine.lock().unwrap();
        engine.is_some()
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");

        {
            let mut engine = self.engine.lock().unwrap();
            if let Some(ref mut loaded_engine) = *engine {
                match loaded_engine {
                    LoadedEngine::Whisper(ref mut whisper) => whisper.unload_model(),
                    LoadedEngine::Parakeet(ref mut parakeet) => parakeet.unload_model(),
                    LoadedEngine::Sherpa(_) => {} // Dropped when enum is dropped
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
            EngineType::SherpaOnnx => {
                let tokens = model_path.join("tokens.txt");
                let encoder = model_path.join("encoder-epoch-99-avg-1.int8.onnx");
                let decoder = model_path.join("decoder-epoch-99-avg-1.int8.onnx");
                let joiner = model_path.join("joiner-epoch-99-avg-1.int8.onnx");

                if !tokens.exists() || !encoder.exists() || !decoder.exists() || !joiner.exists() {
                     let error_msg = format!("Missing required model files in {:?}", model_path);
                     let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "loading_failed".to_string(),
                            model_id: Some(model_id.to_string()),
                            model_name: Some(model_info.name.clone()),
                            error: Some(error_msg.clone()),
                        },
                    );
                    return Err(anyhow::anyhow!(error_msg));
                }

                let recognizer = SherpaStreamingZipformer::new(
                    encoder.to_string_lossy().to_string(),
                    decoder.to_string_lossy().to_string(),
                    joiner.to_string_lossy().to_string(),
                    tokens.to_string_lossy().to_string(),
                    "cpu".to_string(),
                    4,
                    false,
                )
                .map_err(|e| {
                    let error_msg = format!("Failed to create Sherpa streaming recognizer: {}", e);
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

                LoadedEngine::Sherpa(recognizer)
            }
        };

        // Update the current engine and model ID
        {
            let mut engine = self.engine.lock().unwrap();
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

        if audio.len() == 0 {
            debug!("Empty audio vector");
            return Ok(String::new());
        }

        // Get current settings for configuration
        let settings = get_settings(&self.app_handle);

        const ONLINE_SAMPLE_RATE: u32 = 16000;

        const ONLINE_TIMEOUT: Duration = Duration::from_secs(20);
        if settings.online_asr_enabled {
            if let Some(asr_id) = &settings.selected_asr_model_id {
                if let Some(cached_model) = settings
                    .cached_models
                    .iter()
                    .find(|cached| &cached.id == asr_id)
                {
                    if let Some(provider) = settings
                        .post_process_providers
                        .iter()
                        .find(|provider| provider.id == cached_model.provider_id)
                    {
                        let api_key = settings
                            .post_process_api_keys
                            .get(&provider.id)
                            .filter(|key| !key.trim().is_empty())
                            .cloned();
                        println!(
                            "Starting online ASR (provider={}, model={})",
                            provider.label, cached_model.model_id
                        );
                        self.emit_online_asr_status("started", None);
                        let provider_clone = provider.clone();
                        let model_id = cached_model.model_id.clone();
                        let audio_clone = audio.clone();
                        let api_key_clone = api_key.clone();

                        let handle = thread::spawn(move || {
                            OnlineAsrClient::new(ONLINE_SAMPLE_RATE, ONLINE_TIMEOUT).transcribe(
                                &provider_clone,
                                api_key_clone,
                                &model_id,
                                &audio_clone,
                            )
                        });

                        return match handle.join() {
                            Ok(Ok(text)) => {
                                self.emit_online_asr_status("completed", None);
                                let corrected = if !settings.custom_words.is_empty() {
                                    apply_custom_words(
                                        &text,
                                        &settings.custom_words,
                                        settings.word_correction_threshold,
                                    )
                                } else {
                                    text
                                };
                                Ok(corrected.trim().to_string())
                            }
                            Ok(Err(err)) => {
                                let detail = err.to_string();
                                self.emit_online_asr_status("failed", Some(detail.clone()));
                                eprintln!("Online ASR failed: {:?}", detail);
                                Err(anyhow::anyhow!("在线 ASR 请求失败：{}", detail))
                            }
                            Err(err) => {
                                let detail = format!("{:?}", err);
                                self.emit_online_asr_status("thread_failed", Some(detail.clone()));
                                eprintln!("Online ASR thread panicked: {:?}", detail);
                                Err(anyhow::anyhow!("在线 ASR 线程异常：{}", detail))
                            }
                        };
                    }
                }
            }
        }

        // Ensure local model is loaded before falling back
        {
            let mut is_loading = self.is_loading.lock().unwrap();
            while *is_loading {
                is_loading = self.loading_condvar.wait(is_loading).unwrap();
            }

            let engine_guard = self.engine.lock().unwrap();
            if engine_guard.is_none() {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        }

        // Perform transcription with the appropriate engine
        let result = {
            let mut engine_guard = self.engine.lock().unwrap();
            let engine = engine_guard.as_mut().ok_or_else(|| {
                anyhow::anyhow!(
                    "Model failed to load after auto-load attempt. Please check your model settings."
                )
            })?;

            match engine {
                LoadedEngine::Whisper(whisper_engine) => {
                    // Normalize language code for Whisper
                    // Convert zh-Hans and zh-Hant to zh since Whisper uses ISO 639-1 codes
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
                        .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))?
                }
                LoadedEngine::Parakeet(parakeet_engine) => {
                    let params = ParakeetInferenceParams {
                        timestamp_granularity: TimestampGranularity::Segment,
                        ..Default::default()
                    };

                    parakeet_engine
                        .transcribe_samples(audio, Some(params))
                        .map_err(|e| anyhow::anyhow!("Parakeet transcription failed: {}", e))?
                }
                LoadedEngine::Sherpa(recognizer) => {
                    // `AudioRecorder` already resamples to 16kHz (constants::WHISPER_SAMPLE_RATE).
                    const SHERPA_SAMPLE_RATE: i32 = 16000;
                    debug!("Sherpa input: {} samples @ {}Hz", audio.len(), SHERPA_SAMPLE_RATE);

                    let text = recognizer.decode(SHERPA_SAMPLE_RATE, &audio)?;
                    
                    transcribe_rs::TranscriptionResult {
                        text: text.clone(),
                        segments: Some(vec![
                            transcribe_rs::TranscriptionSegment {
                                text: text.clone(),
                                start: 0.0,
                                end: 0.0,
                            }
                        ]),
                    }
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

        let final_result = corrected_result.trim().to_string();

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            info!("Transcription result: {}", final_result);
        }

        // Check if we should immediately unload the model after transcription
        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
            info!("Immediately unloading model after transcription");
            if let Err(e) = self.unload_model() {
                error!("Failed to immediately unload model: {}", e);
            }
        }

        Ok(final_result)
    }
    fn emit_online_asr_status(&self, stage: &str, detail: Option<String>) {
        let _ = self.app_handle.emit(
            "online-asr-status",
            OnlineAsrStatusEvent {
                stage: stage.to_string(),
                detail,
            },
        );
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
