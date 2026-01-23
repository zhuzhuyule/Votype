use crate::managers::model::{EngineType, ModelManager};
use crate::online_asr::{OnlineAsrClient, OnlineAsrStatusEvent};
use crate::settings::{get_settings, ModelUnloadTimeout};
use anyhow::Result;
use log::{debug, error, info, warn};
use serde::Serialize;
use std::collections::VecDeque;
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

use crate::sherpa::ffi_safe as sherpa_safe;
use crate::sherpa::{find_sherpa_onnx, find_sherpa_tokens};

mod sherpa_engine;

use sherpa_engine::{
    SherpaOnnxOfflinePunctuation, SherpaOnnxOfflineRecognizer, SherpaOnnxOnlineRecognizer,
};

struct SherpaOnlineSession {
    stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
    sample_rate: i32,
    committed_text: String,
    last_text: String,
    last_emit_ms: u64,
    last_punct_emit_ms: u64,
    last_punct_text: String,
    last_punctuated_text: String,
}

unsafe impl Send for SherpaOnlineSession {}
unsafe impl Sync for SherpaOnlineSession {}

/// Session for VAD-based streaming with offline models.
/// Accumulates audio segments and transcribes each segment when silence is detected.
struct OfflineVadSegment {
    audio: Vec<f32>,
    text: String,
}

struct OfflineRealtimeJob {
    now_ms: u64,
    stable_text: String,
    tail_audio: Vec<f32>,
}

struct SherpaOfflineSession {
    /// All audio samples collected during recording (for final re-transcription)
    all_samples: Vec<f32>,
    /// Current pending audio segment waiting for transcription
    pending_audio: Vec<f32>,
    /// Rolling window of the most recent VAD segments (for contextual realtime decode)
    recent_segments: VecDeque<OfflineVadSegment>,
    /// Stable prefix text older than `recent_segments`
    prefix_text: String,
    /// Timestamp of last speech frame received (for silence detection)
    last_voice_ms: u64,
    /// Timestamp of last emission (for throttling)
    last_emit_ms: u64,
    /// Timestamp of last forced emission (2s interval)
    last_force_ms: u64,
    /// Last emitted display text (for change detection)
    last_emit_text: String,
    /// Sender for the realtime decode worker. Dropping it stops the worker.
    realtime_tx: Option<std::sync::mpsc::SyncSender<OfflineRealtimeJob>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SherpaPartialEvent {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub punctuated_text: Option<String>,
    pub is_final: bool,
}

enum LoadedEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetEngine),
    SherpaOnline(Arc<SherpaOnnxOnlineRecognizer>),
    SherpaOffline(Arc<SherpaOnnxOfflineRecognizer>),
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
    sherpa_session: Arc<Mutex<Option<SherpaOnlineSession>>>,
    sherpa_offline_session: Arc<Mutex<Option<SherpaOfflineSession>>>,
    sherpa_offline_decode_lock: Arc<Mutex<()>>,
    punctuation: Arc<Mutex<Option<(String, SherpaOnnxOfflinePunctuation)>>>,
}

impl TranscriptionManager {
    fn join_stable_offline_text(
        prefix_text: &str,
        recent_segments: &VecDeque<OfflineVadSegment>,
    ) -> String {
        let mut out = prefix_text.trim().to_string();
        for seg in recent_segments.iter() {
            let t = seg.text.trim();
            if t.is_empty() {
                continue;
            }
            out = Self::merge_text_with_overlap(&out, t);
        }
        out
    }

    fn merge_text_with_overlap(stable_text: &str, tail_text: &str) -> String {
        let stable = stable_text.trim_end();
        let tail = tail_text.trim_start();
        if stable.is_empty() {
            return tail_text.trim().to_string();
        }
        if tail.is_empty() {
            return stable.to_string();
        }

        let stable_chars: Vec<char> = stable.chars().collect();
        let tail_chars: Vec<char> = tail.chars().collect();
        let max_overlap = stable_chars.len().min(tail_chars.len()).min(200);

        // Allow small overlaps to avoid duplicate Chinese characters at chunk boundaries.
        for overlap in (3..=max_overlap).rev() {
            let stable_suffix: String = stable_chars[stable_chars.len() - overlap..]
                .iter()
                .collect();
            let tail_prefix: String = tail_chars[..overlap].iter().collect();
            if stable_suffix == tail_prefix {
                let tail_rest: String = tail_chars[overlap..].iter().collect();
                let tail_rest = tail_rest.trim_start();
                if tail_rest.is_empty() {
                    return stable.to_string();
                }
                if stable.ends_with('\n') {
                    return format!("{}{}", stable, tail_rest);
                }
                return format!("{}\n{}", stable, tail_rest);
            }
        }

        if stable.ends_with('\n') {
            format!("{}{}", stable, tail)
        } else {
            format!("{}\n{}", stable, tail)
        }
    }

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
            sherpa_session: Arc::new(Mutex::new(None)),
            sherpa_offline_session: Arc::new(Mutex::new(None)),
            sherpa_offline_decode_lock: Arc::new(Mutex::new(())),
            punctuation: Arc::new(Mutex::new(None)),
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

    pub fn is_current_sherpa_online(&self) -> bool {
        let engine_guard = self.engine.lock().unwrap();
        matches!(engine_guard.as_ref(), Some(LoadedEngine::SherpaOnline(_)))
    }

    pub fn is_current_sherpa_offline(&self) -> bool {
        let engine_guard = self.engine.lock().unwrap();
        matches!(engine_guard.as_ref(), Some(LoadedEngine::SherpaOffline(_)))
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");

        {
            let mut session = self.sherpa_session.lock().unwrap();
            if let Some(sess) = session.take() {
                unsafe {
                    sherpa_safe::SafeSherpaOnnxDestroyOnlineStream(sess.stream);
                }
            }
        }

        {
            let mut punct = self.punctuation.lock().unwrap();
            *punct = None;
        }

        {
            let mut engine = self.engine.lock().unwrap();
            if let Some(ref mut loaded_engine) = *engine {
                match loaded_engine {
                    LoadedEngine::Whisper(ref mut whisper) => whisper.unload_model(),
                    LoadedEngine::Parakeet(ref mut parakeet) => parakeet.unload_model(),
                    LoadedEngine::SherpaOnline(_) => {} // Dropped when enum is dropped
                    LoadedEngine::SherpaOffline(_) => {} // Dropped when enum is dropped
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
                let (mode, family, prefer_int8) = if let Some(spec) = model_info.sherpa.as_ref() {
                    (spec.mode.clone(), spec.family.clone(), spec.prefer_int8)
                } else {
                    // Backward-compatible fallback if a Sherpa model lacks explicit metadata.
                    // Some catalog entries may have generic filenames (e.g. `model.zip`), so infer
                    // Sherpa model family from multiple metadata fields.
                    let lower = format!("{} {} {}", model_id, model_info.filename, model_info.name)
                        .to_lowercase();
                    let prefer_int8 = lower.contains("int8");
                    let is_streaming = lower.contains("streaming");
                    let family = if lower.contains("ctc") {
                        crate::managers::model::SherpaOnnxAsrFamily::Zipformer2Ctc
                    } else if lower.contains("paraformer") {
                        crate::managers::model::SherpaOnnxAsrFamily::Paraformer
                    } else if lower.contains("sense-voice") {
                        crate::managers::model::SherpaOnnxAsrFamily::SenseVoice
                    } else if lower.contains("fire-red-asr") {
                        crate::managers::model::SherpaOnnxAsrFamily::FireRedAsr
                    } else {
                        crate::managers::model::SherpaOnnxAsrFamily::Transducer
                    };
                    let mode = if is_streaming {
                        crate::managers::model::SherpaOnnxAsrMode::Streaming
                    } else {
                        crate::managers::model::SherpaOnnxAsrMode::Offline
                    };
                    (mode, family, prefer_int8)
                };

                debug!(
                    "Sherpa model spec resolved: mode={:?}, family={:?}, prefer_int8={}",
                    mode, family, prefer_int8
                );

                let tokens = find_sherpa_tokens(&model_path).map_err(|e| {
                    let error_msg = format!("Missing Sherpa tokens in {:?}: {}", model_path, e);
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

                if matches!(mode, crate::managers::model::SherpaOnnxAsrMode::Streaming) {
                    if matches!(
                        family,
                        crate::managers::model::SherpaOnnxAsrFamily::Zipformer2Ctc
                    ) {
                        let model_file = find_sherpa_onnx(&model_path, "ctc", prefer_int8)
                            .or_else(|_| find_sherpa_onnx(&model_path, "model", prefer_int8))
                            .map_err(|e| {
                                let error_msg =
                                    format!("Missing Sherpa CTC model in {:?}: {}", model_path, e);
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

                        let recognizer = SherpaOnnxOnlineRecognizer::new_zipformer2_ctc(
                            model_file.to_string_lossy().to_string(),
                            tokens.to_string_lossy().to_string(),
                            "cpu".to_string(),
                            4,
                            false,
                        )
                        .map_err(|e| {
                            let error_msg =
                                format!("Failed to create Sherpa zipformer2 CTC recognizer: {}", e);
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

                        LoadedEngine::SherpaOnline(Arc::new(recognizer))
                    } else {
                        let encoder = find_sherpa_onnx(&model_path, "encoder", prefer_int8)
                            .map_err(|e| {
                                let error_msg =
                                    format!("Missing Sherpa encoder in {:?}: {}", model_path, e);
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

                        let decoder = find_sherpa_onnx(&model_path, "decoder", prefer_int8)
                            .map_err(|e| {
                                let error_msg =
                                    format!("Missing Sherpa decoder in {:?}: {}", model_path, e);
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

                        let recognizer = if matches!(
                            family,
                            crate::managers::model::SherpaOnnxAsrFamily::Paraformer
                        ) {
                            SherpaOnnxOnlineRecognizer::new_paraformer(
                                encoder.to_string_lossy().to_string(),
                                decoder.to_string_lossy().to_string(),
                                tokens.to_string_lossy().to_string(),
                                "cpu".to_string(),
                                4,
                                false,
                            )
                        } else {
                            let joiner = find_sherpa_onnx(&model_path, "joiner", prefer_int8)
                                .map_err(|e| {
                                    let error_msg =
                                        format!("Missing Sherpa joiner in {:?}: {}", model_path, e);
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
                            SherpaOnnxOnlineRecognizer::new_transducer(
                                encoder.to_string_lossy().to_string(),
                                decoder.to_string_lossy().to_string(),
                                joiner.to_string_lossy().to_string(),
                                tokens.to_string_lossy().to_string(),
                                "cpu".to_string(),
                                4,
                                false,
                            )
                        }
                        .map_err(|e| {
                            let error_msg =
                                format!("Failed to create Sherpa online recognizer: {}", e);
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

                        LoadedEngine::SherpaOnline(Arc::new(recognizer))
                    }
                } else if matches!(
                    family,
                    crate::managers::model::SherpaOnnxAsrFamily::SenseVoice
                ) {
                    let model_file =
                        find_sherpa_onnx(&model_path, "model", prefer_int8).map_err(|e| {
                            let error_msg =
                                format!("Missing SenseVoice model in {:?}: {}", model_path, e);
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

                    let settings = get_settings(&self.app_handle);
                    let normalized_lang = match settings.selected_language.as_str() {
                        "auto" => "auto".to_string(),
                        "zh" | "zh-Hans" | "zh-Hant" => "zh".to_string(),
                        "en" => "en".to_string(),
                        "ja" => "ja".to_string(),
                        "ko" => "ko".to_string(),
                        "yue" | "zh-yue" => "yue".to_string(),
                        _ => "auto".to_string(),
                    };

                    let recognizer = SherpaOnnxOfflineRecognizer::new_sense_voice(
                        model_file.to_string_lossy().to_string(),
                        tokens.to_string_lossy().to_string(),
                        normalized_lang,
                        true, // ITN always enabled (no longer configurable)
                        "cpu".to_string(),
                        4,
                        false,
                    )
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to create SenseVoice offline recognizer: {}", e);
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

                    LoadedEngine::SherpaOffline(Arc::new(recognizer))
                } else if matches!(
                    family,
                    crate::managers::model::SherpaOnnxAsrFamily::Paraformer
                ) {
                    let model_file =
                        find_sherpa_onnx(&model_path, "model", prefer_int8).map_err(|e| {
                            let error_msg =
                                format!("Missing Paraformer model in {:?}: {}", model_path, e);
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

                    let recognizer = SherpaOnnxOfflineRecognizer::new_paraformer(
                        model_file.to_string_lossy().to_string(),
                        tokens.to_string_lossy().to_string(),
                        "cpu".to_string(),
                        4,
                        false,
                    )
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to create Paraformer offline recognizer: {}", e);
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

                    LoadedEngine::SherpaOffline(Arc::new(recognizer))
                } else if matches!(
                    family,
                    crate::managers::model::SherpaOnnxAsrFamily::FireRedAsr
                ) {
                    let encoder =
                        find_sherpa_onnx(&model_path, "encoder", prefer_int8).map_err(|e| {
                            let error_msg =
                                format!("Missing FireRedASR encoder in {:?}: {}", model_path, e);
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

                    let decoder =
                        find_sherpa_onnx(&model_path, "decoder", prefer_int8).map_err(|e| {
                            let error_msg =
                                format!("Missing FireRedASR decoder in {:?}: {}", model_path, e);
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

                    let recognizer = SherpaOnnxOfflineRecognizer::new_fire_red_asr(
                        encoder.to_string_lossy().to_string(),
                        decoder.to_string_lossy().to_string(),
                        tokens.to_string_lossy().to_string(),
                        "cpu".to_string(),
                        4,
                        false,
                    )
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to create FireRedASR offline recognizer: {}", e);
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

                    LoadedEngine::SherpaOffline(Arc::new(recognizer))
                } else {
                    let error_msg = format!("Unsupported Sherpa model: {}", model_info.filename);
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
            }
            EngineType::SherpaOnnxPunctuation => {
                return Err(anyhow::anyhow!(
                    "Punctuation models cannot be loaded as transcription engines"
                ));
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

    fn wait_for_local_engine(&self) -> Result<()> {
        let mut is_loading = self.is_loading.lock().unwrap();
        while *is_loading {
            is_loading = self.loading_condvar.wait(is_loading).unwrap();
        }

        let engine_guard = self.engine.lock().unwrap();
        if engine_guard.is_none() {
            return Err(anyhow::anyhow!("Model is not loaded for transcription."));
        }
        Ok(())
    }

    pub fn start_sherpa_online_session(&self) -> Result<()> {
        self.wait_for_local_engine()?;

        let engine_guard = self.engine.lock().unwrap();
        let Some(LoadedEngine::SherpaOnline(recognizer)) = engine_guard.as_ref() else {
            return Err(anyhow::anyhow!(
                "Selected engine is not a Sherpa streaming model"
            ));
        };

        let mut session_guard = self.sherpa_session.lock().unwrap();
        if session_guard.is_some() {
            return Ok(());
        }

        let stream = recognizer.create_stream()?;
        *session_guard = Some(SherpaOnlineSession {
            stream,
            sample_rate: 16000,
            committed_text: String::new(),
            last_text: String::new(),
            last_emit_ms: 0,
            last_punct_emit_ms: 0,
            last_punct_text: String::new(),
            last_punctuated_text: String::new(),
        });
        Ok(())
    }

    pub fn feed_sherpa_online_session(&self, samples: &[f32]) -> Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        self.start_sherpa_online_session()?;

        let settings = get_settings(&self.app_handle);

        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let engine_guard = self.engine.lock().unwrap();
        let Some(LoadedEngine::SherpaOnline(recognizer)) = engine_guard.as_ref() else {
            return Err(anyhow::anyhow!(
                "Selected engine is not a Sherpa streaming model"
            ));
        };

        let mut session_guard = self.sherpa_session.lock().unwrap();
        let Some(sess) = session_guard.as_mut() else {
            return Err(anyhow::anyhow!("Sherpa session not initialized"));
        };

        recognizer.accept_waveform(sess.stream, sess.sample_rate, samples);
        recognizer.decode_ready(sess.stream);

        // Throttle event emission a bit to reduce frontend spam.
        if now_ms.saturating_sub(sess.last_emit_ms) < 100 {
            return Ok(());
        }

        let current = recognizer.get_text(sess.stream);
        let current = current.trim().to_string();
        let mut combined = sess.committed_text.clone();
        if !current.is_empty() {
            combined.push_str(&current);
        }

        let mut endpoint_triggered = false;
        if recognizer.is_endpoint(sess.stream) {
            endpoint_triggered = true;
            if !current.is_empty() {
                sess.committed_text.push_str(&current);
                sess.committed_text.push('\n');
            }
            recognizer.reset_stream(sess.stream);
            combined = sess.committed_text.clone();
        }

        if combined != sess.last_text {
            let mut punctuated_text: Option<String> = None;
            if settings.punctuation_enabled && !combined.trim().is_empty() {
                let punct_model_id = settings.punctuation_model.trim();
                if !punct_model_id.is_empty() {
                    let is_downloaded = self
                        .model_manager
                        .get_model_info(punct_model_id)
                        .is_some_and(|m| m.is_downloaded);
                    if is_downloaded {
                        let punct_due = endpoint_triggered
                            || now_ms.saturating_sub(sess.last_punct_emit_ms) >= 1_000;
                        if punct_due && combined != sess.last_punct_text {
                            match self.apply_punctuation_multiline(punct_model_id, &combined) {
                                Ok(punctuated) => {
                                    if !punctuated.trim().is_empty() {
                                        sess.last_punct_emit_ms = now_ms;
                                        sess.last_punct_text = combined.clone();
                                        sess.last_punctuated_text = punctuated.clone();
                                        punctuated_text = Some(punctuated);
                                    }
                                }
                                Err(e) => {
                                    warn!("Streaming punctuation failed: {}", e);
                                }
                            }
                        }

                        // Avoid UI flicker: if we already have a punctuated prefix, keep emitting it
                        // and just append the current raw suffix until the next punctuation refresh.
                        if punctuated_text.is_none()
                            && !sess.last_punct_text.is_empty()
                            && !sess.last_punctuated_text.is_empty()
                            && combined.starts_with(&sess.last_punct_text)
                        {
                            let suffix = &combined[sess.last_punct_text.len()..];
                            let suffix_has_speech =
                                !suffix.trim().is_empty() && !suffix.starts_with('\n');
                            if suffix_has_speech
                                && (sess.last_punctuated_text.ends_with('。')
                                    || sess.last_punctuated_text.ends_with('.'))
                            {
                                // If the punctuation model ended the current partial with a period,
                                // and we later continue speaking, keep the UI stable by removing
                                // that terminal punctuation until the next punctuation refresh.
                                sess.last_punctuated_text.pop();
                            }
                            punctuated_text =
                                Some(format!("{}{}", sess.last_punctuated_text, suffix));
                        }
                    }
                }
            }

            sess.last_text = combined.clone();
            sess.last_emit_ms = now_ms;
            let _ = self.app_handle.emit(
                "sherpa-online-partial",
                SherpaPartialEvent {
                    text: combined,
                    punctuated_text,
                    is_final: false,
                },
            );
        }

        Ok(())
    }

    pub fn finish_sherpa_online_session(&self) -> Result<String> {
        self.wait_for_local_engine()?;

        let engine_guard = self.engine.lock().unwrap();
        let Some(LoadedEngine::SherpaOnline(recognizer)) = engine_guard.as_ref() else {
            return Err(anyhow::anyhow!(
                "Selected engine is not a Sherpa streaming model"
            ));
        };

        let sess = self.sherpa_session.lock().unwrap().take();
        let Some(sess) = sess else {
            return Ok(String::new());
        };

        // Add some tail paddings to flush the final tokens.
        let tail_len = (sess.sample_rate as usize * 3) / 10; // 0.3 seconds
        let tail = vec![0.0f32; tail_len];
        recognizer.accept_waveform(sess.stream, sess.sample_rate, &tail);
        recognizer.input_finished(sess.stream);
        recognizer.decode_ready(sess.stream);

        let current = recognizer.get_text(sess.stream);
        let current = current.trim().to_string();
        let mut combined = sess.committed_text;
        if !current.is_empty() {
            combined.push_str(&current);
        }
        let text = combined.trim_end().to_string();

        unsafe {
            sherpa_safe::SafeSherpaOnnxDestroyOnlineStream(sess.stream);
        }

        let settings = get_settings(&self.app_handle);
        let mut punctuated_text: Option<String> = None;
        let mut final_text = text.clone();
        if settings.punctuation_enabled && !final_text.trim().is_empty() {
            let punct_model_id = settings.punctuation_model.trim();
            if !punct_model_id.is_empty() {
                let is_downloaded = self
                    .model_manager
                    .get_model_info(punct_model_id)
                    .is_some_and(|m| m.is_downloaded);
                if is_downloaded {
                    match self.apply_punctuation_multiline(punct_model_id, &final_text) {
                        Ok(punctuated) => {
                            if !punctuated.trim().is_empty() {
                                punctuated_text = Some(punctuated.clone());
                                final_text = punctuated;
                            }
                        }
                        Err(e) => {
                            warn!("Final streaming punctuation failed: {}", e);
                        }
                    }
                }
            }
        }

        let _ = self.app_handle.emit(
            "sherpa-online-partial",
            SherpaPartialEvent {
                text,
                punctuated_text,
                is_final: true,
            },
        );

        Ok(final_text)
    }

    pub fn abort_sherpa_online_session(&self) -> Option<String> {
        let sess = self.sherpa_session.lock().unwrap().take();
        if let Some(sess) = sess {
            let text = sess.last_text;
            unsafe {
                sherpa_safe::SafeSherpaOnnxDestroyOnlineStream(sess.stream);
            }
            if text.trim().is_empty() {
                None
            } else {
                Some(text)
            }
        } else {
            None
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sherpa Offline VAD Streaming Session
    // ─────────────────────────────────────────────────────────────────────────

    /// Start a new offline streaming session for VAD-based segment transcription.
    pub fn start_sherpa_offline_session(&self) -> Result<()> {
        self.wait_for_local_engine()?;

        let engine_guard = self.engine.lock().unwrap();
        if !matches!(engine_guard.as_ref(), Some(LoadedEngine::SherpaOffline(_))) {
            return Err(anyhow::anyhow!(
                "Selected engine is not a Sherpa offline model"
            ));
        }

        let mut session_guard = self.sherpa_offline_session.lock().unwrap();
        if session_guard.is_some() {
            return Ok(());
        }

        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        *session_guard = Some(SherpaOfflineSession {
            all_samples: Vec::new(),
            pending_audio: Vec::new(),
            recent_segments: VecDeque::new(),
            prefix_text: String::new(),
            last_voice_ms: now_ms,
            last_emit_ms: 0,
            last_force_ms: now_ms,
            last_emit_text: String::new(),
            realtime_tx: None,
        });

        // Start a lightweight realtime decode worker for UI feedback. This worker is best-effort:
        // it skips work if the engine is busy (e.g. final transcription) to avoid deadlocks.
        let tm = self.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel::<OfflineRealtimeJob>(1);
        std::thread::spawn(move || {
            let mut punctuation_cache: Option<(String, SherpaOnnxOfflinePunctuation)> = None;
            let mut last_log_time = std::time::Instant::now();

            while let Ok(mut job) = rx.recv() {
                // Coalesce: keep only the latest pending job.
                while let Ok(next) = rx.try_recv() {
                    job = next;
                }

                if let Err(e) =
                    tm.process_offline_realtime_job(job, &mut punctuation_cache, &mut last_log_time)
                {
                    warn!("Offline realtime decode failed: {}", e);
                }
            }
        });

        if let Some(sess) = session_guard.as_mut() {
            sess.realtime_tx = Some(tx);
        }

        debug!("Started Sherpa offline streaming session");
        Ok(())
    }

    /// Feed audio samples to the offline streaming session.
    /// VAD-filtered speech frames are accumulated. Transcription happens when silence is detected.
    pub fn feed_sherpa_offline_session(&self, samples: &[f32]) -> Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        self.start_sherpa_offline_session()?;

        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut session_guard = self.sherpa_offline_session.lock().unwrap();
        let Some(sess) = session_guard.as_mut() else {
            return Err(anyhow::anyhow!("Sherpa offline session not initialized"));
        };

        // Accumulate all samples for final re-transcription
        sess.all_samples.extend_from_slice(samples);
        // Accumulate pending audio for segment transcription
        sess.pending_audio.extend_from_slice(samples);
        // Update timestamp - this is used to detect when speech stops
        sess.last_voice_ms = now_ms;

        Ok(())
    }

    fn enqueue_sherpa_offline_realtime_partial(&self, now_ms: u64) -> Result<()> {
        const SAMPLE_RATE: usize = 16000;

        let settings = get_settings(&self.app_handle);
        let window_seconds = settings.offline_vad_force_window_seconds.max(1) as usize;
        let window_samples = window_seconds * SAMPLE_RATE;
        let context_samples = (SAMPLE_RATE as f64 * 0.6) as usize; // small context for boundary continuity

        let (stable_text, tail_audio, tx) = {
            let session_guard = self.sherpa_offline_session.lock().unwrap();
            let Some(sess) = session_guard.as_ref() else {
                return Ok(());
            };

            if sess.all_samples.is_empty() {
                return Ok(());
            }

            let stable_text =
                Self::join_stable_offline_text(&sess.prefix_text, &sess.recent_segments);

            let mut out = Vec::new();
            if let Some(last_seg) = sess.recent_segments.back() {
                if !last_seg.audio.is_empty() && context_samples > 0 {
                    let start = last_seg.audio.len().saturating_sub(context_samples);
                    out.extend_from_slice(&last_seg.audio[start..]);
                }
            }
            if !sess.pending_audio.is_empty() {
                let start = sess.pending_audio.len().saturating_sub(window_samples);
                out.extend_from_slice(&sess.pending_audio[start..]);
            }

            (stable_text, out, sess.realtime_tx.clone())
        };

        let Some(tx) = tx else {
            return Ok(());
        };
        let _ = tx.try_send(OfflineRealtimeJob {
            now_ms,
            stable_text,
            tail_audio,
        });

        Ok(())
    }

    fn process_offline_realtime_job(
        &self,
        job: OfflineRealtimeJob,
        punctuation_cache: &mut Option<(String, SherpaOnnxOfflinePunctuation)>,
        last_log_time: &mut std::time::Instant,
    ) -> Result<()> {
        // Best-effort: do not block final transcription or model operations.
        let recognizer = match self.engine.try_lock() {
            Ok(g) => match g.as_ref() {
                Some(LoadedEngine::SherpaOffline(recognizer)) => Arc::clone(recognizer),
                _ => return Ok(()),
            },
            Err(_) => return Ok(()),
        };

        let tail_text = if job.tail_audio.is_empty() {
            String::new()
        } else {
            let decode_guard = match self.sherpa_offline_decode_lock.try_lock() {
                Ok(g) => g,
                Err(_) => return Ok(()),
            };
            let t = recognizer
                .decode(16000, &job.tail_audio)?
                .trim()
                .to_string();
            drop(decode_guard);
            t
        };

        let display_text = Self::merge_text_with_overlap(&job.stable_text, &tail_text);

        let display_text = display_text.trim().to_string();
        if display_text.is_empty() {
            return Ok(());
        }

        let settings = get_settings(&self.app_handle);
        let mut punctuated_text: Option<String> = None;
        if settings.punctuation_enabled {
            let punct_model_id = settings.punctuation_model.trim();
            if !punct_model_id.is_empty() {
                let is_downloaded = self
                    .model_manager
                    .get_model_info(punct_model_id)
                    .is_some_and(|m| m.is_downloaded);
                if is_downloaded {
                    if punctuation_cache
                        .as_ref()
                        .is_none_or(|(id, _)| id != punct_model_id)
                    {
                        let model_path = self.model_manager.get_model_path(punct_model_id)?;
                        let prefer_int8 = self
                            .model_manager
                            .get_model_info(punct_model_id)
                            .map(|m| m.filename.to_lowercase().contains("int8"))
                            .unwrap_or(true);

                        let model_file = find_sherpa_onnx(&model_path, "model", prefer_int8)?
                            .to_string_lossy()
                            .to_string();

                        let punct = SherpaOnnxOfflinePunctuation::new_ct_transformer(
                            model_file,
                            "cpu".to_string(),
                            2,
                            false,
                        )?;
                        *punctuation_cache = Some((punct_model_id.to_string(), punct));
                    }

                    if let Some((_, punct)) = punctuation_cache.as_ref() {
                        let punctuated = if display_text.contains('\n') {
                            let mut out_lines = Vec::new();
                            for line in display_text.split('\n') {
                                if line.trim().is_empty() {
                                    out_lines.push(String::new());
                                } else {
                                    out_lines.push(punct.add_punct(line)?);
                                }
                            }
                            out_lines.join("\n")
                        } else {
                            punct.add_punct(&display_text)?
                        };

                        let punctuated = punctuated.trim().to_string();
                        if !punctuated.is_empty() {
                            punctuated_text = Some(punctuated);
                        }
                    }
                }
            }
        }

        {
            let mut session_guard = self.sherpa_offline_session.lock().unwrap();
            if let Some(sess) = session_guard.as_mut() {
                if sess.last_emit_text == display_text {
                    return Ok(());
                }
                sess.last_emit_text = display_text.clone();
                sess.last_emit_ms = job.now_ms;
            }
        }

        let _ = self.app_handle.emit(
            "sherpa-offline-partial",
            SherpaPartialEvent {
                text: display_text.clone(),
                punctuated_text: punctuated_text.clone(),
                is_final: false,
            },
        );

        // Periodic logging of valid overlay content (every ~5s)
        if last_log_time.elapsed().as_secs() >= 5 {
            let log_text = punctuated_text.as_ref().unwrap_or(&display_text);
            let clean_log_text = log_text.replace('\n', " ");

            // Safe truncation for UTF-8 characters
            let char_count = clean_log_text.chars().count();
            let preview = if char_count > 100 {
                let skip = char_count - 100;
                let tail: String = clean_log_text.chars().skip(skip).collect();
                format!("...{}", tail)
            } else {
                clean_log_text
            };

            info!("[Overlay Preview] chars={} {}", char_count, preview);
            *last_log_time = std::time::Instant::now();
        }

        Ok(())
    }

    /// Force a realtime emission on an interval to improve long-utterance feedback.
    pub fn maybe_force_sherpa_offline_partial(&self) -> Result<()> {
        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let settings = get_settings(&self.app_handle);
        let interval_ms = settings.offline_vad_force_interval_ms;
        if interval_ms == 0 {
            return Ok(());
        }

        {
            let mut session_guard = self.sherpa_offline_session.lock().unwrap();
            let Some(sess) = session_guard.as_mut() else {
                return Ok(());
            };
            if now_ms.saturating_sub(sess.last_force_ms) < interval_ms {
                return Ok(());
            }
            sess.last_force_ms = now_ms;
        }

        self.maybe_roll_sherpa_offline_pending(now_ms)?;
        self.enqueue_sherpa_offline_realtime_partial(now_ms)
    }

    fn maybe_roll_sherpa_offline_pending(&self, now_ms: u64) -> Result<()> {
        const SAMPLE_RATE: usize = 16000;
        const ROLL_SECONDS: usize = 5;
        const OVERLAP_MS: usize = 600;

        let settings = get_settings(&self.app_handle);
        let window_seconds = settings.offline_vad_force_window_seconds.max(1) as usize;
        let window_samples = window_seconds * SAMPLE_RATE;
        let roll_samples = ROLL_SECONDS * SAMPLE_RATE;
        let overlap_samples = (SAMPLE_RATE * OVERLAP_MS) / 1000;

        let chunk_audio = {
            let mut session_guard = self.sherpa_offline_session.lock().unwrap();
            let Some(sess) = session_guard.as_mut() else {
                return Ok(());
            };

            if sess.pending_audio.len() <= window_samples + roll_samples {
                return Ok(());
            }

            let take = (roll_samples + overlap_samples).min(sess.pending_audio.len());
            let chunk = sess.pending_audio[..take].to_vec();
            let drain = roll_samples.min(sess.pending_audio.len());
            sess.pending_audio.drain(0..drain);
            sess.last_voice_ms = now_ms;
            chunk
        };

        // Best-effort: if engine/decode lock is busy, skip and try again on the next interval.
        let recognizer = match self.engine.try_lock() {
            Ok(g) => match g.as_ref() {
                Some(LoadedEngine::SherpaOffline(recognizer)) => Arc::clone(recognizer),
                _ => return Ok(()),
            },
            Err(_) => return Ok(()),
        };

        let decoded_text = match self.sherpa_offline_decode_lock.try_lock() {
            Ok(_guard) => match recognizer.decode(16000, &chunk_audio) {
                Ok(t) => t.trim().to_string(),
                Err(e) => {
                    warn!("Offline rolling decode failed: {}", e);
                    String::new()
                }
            },
            Err(_) => return Ok(()),
        };

        if decoded_text.trim().is_empty() {
            return Ok(());
        }

        {
            let mut session_guard = self.sherpa_offline_session.lock().unwrap();
            if let Some(sess) = session_guard.as_mut() {
                sess.recent_segments.push_back(OfflineVadSegment {
                    audio: chunk_audio,
                    text: decoded_text,
                });
                while sess.recent_segments.len() > 3 {
                    if let Some(old) = sess.recent_segments.pop_front() {
                        let old_text = old.text.trim();
                        if !old_text.is_empty() {
                            sess.prefix_text =
                                Self::merge_text_with_overlap(&sess.prefix_text, old_text);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Check for silence timeout and trigger segment transcription if needed.
    /// This is called periodically; when VAD stops sending frames (silence detected),
    /// we transcribe the accumulated audio.
    pub fn check_sherpa_offline_silence(&self) -> Result<()> {
        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Short timeout to quickly detect speech-to-silence transition
        // The recv_timeout in the worker is 100ms, so 200ms means ~2 missed frames = silence
        const SILENCE_TIMEOUT_MS: u64 = 200;
        const MIN_SEGMENT_SAMPLES: usize = 1600; // Minimum 100ms of audio to transcribe

        let segment_audio = {
            let mut session_guard = self.sherpa_offline_session.lock().unwrap();
            let Some(sess) = session_guard.as_mut() else {
                return Ok(());
            };

            let silence_duration_ms = now_ms.saturating_sub(sess.last_voice_ms);

            // Allow manual override of the max segment size via the "force window" setting,
            // but ensure a reasonable minimum (e.g. 60s) to avoid frequent cutting.
            let settings = get_settings(&self.app_handle);
            let window_secs = settings.offline_vad_force_window_seconds.max(30) as f64;
            // Force commit if buffer grows beyond ~1.5x the window or 60s, whichever is larger,
            // to prevents unbounded growth during continuous speech.
            let max_samples = (window_secs * 1.5).max(60.0) * 16000.0;
            let force_commit = sess.pending_audio.len() as f64 > max_samples;

            if !force_commit
                && (silence_duration_ms < SILENCE_TIMEOUT_MS
                    || sess.pending_audio.len() < MIN_SEGMENT_SAMPLES)
            {
                return Ok(());
            }

            debug!(
                "Offline VAD commit: silence={}ms, samples={}, force={}",
                silence_duration_ms,
                sess.pending_audio.len(),
                force_commit
            );

            // If forced, we treat it as if voice "just ended" to mark the boundary,
            // though physically the user is still speaking.
            sess.last_voice_ms = now_ms;
            std::mem::take(&mut sess.pending_audio)
        };

        // Segment commits must be reliable, otherwise long recordings will "lose" the stable
        // prefix. We avoid holding `engine` during decode to prevent deadlocks with stop/final
        // transcription, but we do serialize offline decodes via `sherpa_offline_decode_lock`.
        let recognizer = {
            let engine_guard = self.engine.lock().unwrap();
            match engine_guard.as_ref() {
                Some(LoadedEngine::SherpaOffline(recognizer)) => Arc::clone(recognizer),
                _ => return Ok(()),
            }
        };

        let segment_text = {
            let _decode_guard = self.sherpa_offline_decode_lock.lock().unwrap();
            match recognizer.decode(16000, &segment_audio) {
                Ok(t) => t.trim().to_string(),
                Err(e) => {
                    warn!("Offline segment decode failed: {}", e);
                    String::new()
                }
            }
        };

        {
            let mut session_guard = self.sherpa_offline_session.lock().unwrap();
            if let Some(sess) = session_guard.as_mut() {
                sess.recent_segments.push_back(OfflineVadSegment {
                    audio: segment_audio,
                    text: segment_text,
                });

                // Keep recent segments buffer within ~30s to prevent ONNX reshape errors
                // and keep realtime decoding fast.
                let mut current_samples: usize =
                    sess.recent_segments.iter().map(|s| s.audio.len()).sum();
                const MAX_RECENT_SAMPLES: usize = 30 * 16000;

                while current_samples > MAX_RECENT_SAMPLES && !sess.recent_segments.is_empty() {
                    if let Some(old) = sess.recent_segments.pop_front() {
                        let old_text = old.text.trim();
                        if !old_text.is_empty() {
                            sess.prefix_text =
                                Self::merge_text_with_overlap(&sess.prefix_text, old_text);
                        }
                        current_samples -= old.audio.len();
                    }
                }
            }
        }

        self.enqueue_sherpa_offline_realtime_partial(now_ms)?;

        Ok(())
    }

    /// Finish the offline streaming session and return the final transcription.
    /// This re-transcribes the complete audio for best quality.
    pub fn finish_sherpa_offline_session(&self) -> Result<String> {
        self.wait_for_local_engine()?;

        let sess = self.sherpa_offline_session.lock().unwrap().take();
        let Some(mut sess) = sess else {
            return Ok(String::new());
        };

        // Stop realtime worker ASAP (it's best-effort and should not contend with final decode).
        let _ = sess.realtime_tx.take();

        if sess.all_samples.is_empty() {
            return Ok(String::new());
        }

        debug!(
            "Finishing offline session with {} total samples",
            sess.all_samples.len()
        );

        // Re-transcribe the complete audio for best quality. Avoid holding `engine` during decode
        // to prevent contention with stop/unload; serialize offline decodes explicitly.
        let recognizer = {
            let engine_guard = self.engine.lock().unwrap();
            match engine_guard.as_ref() {
                Some(LoadedEngine::SherpaOffline(recognizer)) => Arc::clone(recognizer),
                _ => {
                    return Err(anyhow::anyhow!(
                        "Selected engine is not a Sherpa offline model"
                    ));
                }
            }
        };
        let text = {
            let _decode_guard = self.sherpa_offline_decode_lock.lock().unwrap();
            recognizer.decode(16000, &sess.all_samples)?
        };

        info!("[Raw Transcription] {}", text.trim());

        let text = text.trim().to_string();
        let settings = get_settings(&self.app_handle);

        // Apply punctuation if enabled
        let mut punctuated_text: Option<String> = None;
        let mut final_text = text.clone();
        if settings.punctuation_enabled && !final_text.trim().is_empty() {
            let punct_model_id = settings.punctuation_model.trim();
            if !punct_model_id.is_empty() {
                let is_downloaded = self
                    .model_manager
                    .get_model_info(punct_model_id)
                    .is_some_and(|m| m.is_downloaded);
                if is_downloaded {
                    match self.apply_punctuation_multiline(punct_model_id, &final_text) {
                        Ok(punctuated) => {
                            if !punctuated.trim().is_empty() {
                                punctuated_text = Some(punctuated.clone());
                                final_text = punctuated;
                            }
                        }
                        Err(e) => {
                            warn!("Final offline punctuation failed: {}", e);
                        }
                    }
                }
            }
        }

        // Emit final result
        let _ = self.app_handle.emit(
            "sherpa-offline-partial",
            SherpaPartialEvent {
                text,
                punctuated_text,
                is_final: true,
            },
        );

        Ok(final_text)
    }

    pub fn abort_sherpa_offline_session(&self) -> Option<String> {
        let sess = self.sherpa_offline_session.lock().unwrap().take();
        if let Some(mut sess) = sess {
            let _ = sess.realtime_tx.take();
            let text = sess.last_emit_text;
            if text.trim().is_empty() {
                None
            } else {
                Some(text)
            }
        } else {
            None
        }
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
                                Ok(text.trim().to_string())
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
                LoadedEngine::SherpaOnline(recognizer) => {
                    // `AudioRecorder` already resamples to 16kHz (constants::WHISPER_SAMPLE_RATE).
                    const SHERPA_SAMPLE_RATE: i32 = 16000;
                    debug!(
                        "Sherpa input: {} samples @ {}Hz",
                        audio.len(),
                        SHERPA_SAMPLE_RATE
                    );

                    let text = recognizer.decode(SHERPA_SAMPLE_RATE, &audio)?;

                    transcribe_rs::TranscriptionResult {
                        text: text.clone(),
                        segments: Some(vec![transcribe_rs::TranscriptionSegment {
                            text: text.clone(),
                            start: 0.0,
                            end: 0.0,
                        }]),
                    }
                }
                LoadedEngine::SherpaOffline(recognizer) => {
                    const SHERPA_SAMPLE_RATE: i32 = 16000;
                    debug!(
                        "Sherpa offline input: {} samples @ {}Hz",
                        audio.len(),
                        SHERPA_SAMPLE_RATE
                    );

                    let _decode_guard = self.sherpa_offline_decode_lock.lock().unwrap();
                    let text = recognizer.decode(SHERPA_SAMPLE_RATE, &audio)?;

                    transcribe_rs::TranscriptionResult {
                        text: text.clone(),
                        segments: Some(vec![transcribe_rs::TranscriptionSegment {
                            text: text.clone(),
                            start: 0.0,
                            end: 0.0,
                        }]),
                    }
                }
            }
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

        let mut final_result = result.text.trim().to_string();

        if settings.punctuation_enabled && !final_result.is_empty() {
            let punct_model_id = settings.punctuation_model.trim();
            if !punct_model_id.is_empty() {
                let should_try = self
                    .model_manager
                    .get_model_info(punct_model_id)
                    .is_some_and(|m| m.is_downloaded);

                if should_try {
                    match self.apply_punctuation(punct_model_id, &final_result) {
                        Ok(punctuated) => {
                            if !punctuated.trim().is_empty() {
                                final_result = punctuated.trim().to_string();
                            }
                        }
                        Err(e) => {
                            warn!("Punctuation post-process failed: {}", e);
                        }
                    }
                } else {
                    debug!(
                        "Punctuation enabled but model not downloaded: {}",
                        punct_model_id
                    );
                }
            }
        }

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

    /// Like `transcribe()`, but forcibly bypasses Online ASR and uses the currently selected
    /// local engine. This is best-effort and may trigger a local model load if needed.
    pub fn transcribe_local_only(&self, audio: Vec<f32>) -> Result<String> {
        // Update last activity timestamp
        self.last_activity.store(
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            Ordering::Relaxed,
        );

        let st = std::time::Instant::now();

        debug!("Local-only audio vector length: {}", audio.len());

        if audio.is_empty() {
            return Ok(String::new());
        }

        let settings = get_settings(&self.app_handle);

        // Ensure local model is loaded (Online ASR mode skips preloading).
        if !self.is_model_loaded() {
            self.initiate_model_load();
        }
        self.wait_for_local_engine()?;

        let result = {
            let mut engine_guard = self.engine.lock().unwrap();
            let engine = engine_guard.as_mut().ok_or_else(|| {
                anyhow::anyhow!(
                    "Model failed to load after auto-load attempt. Please check your model settings."
                )
            })?;

            match engine {
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
                LoadedEngine::SherpaOnline(recognizer) => {
                    const SHERPA_SAMPLE_RATE: i32 = 16000;
                    debug!(
                        "Sherpa streaming (local-only) input: {} samples @ {}Hz",
                        audio.len(),
                        SHERPA_SAMPLE_RATE
                    );

                    let text = recognizer.decode(SHERPA_SAMPLE_RATE, &audio)?;

                    transcribe_rs::TranscriptionResult {
                        text: text.clone(),
                        segments: Some(vec![transcribe_rs::TranscriptionSegment {
                            text: text.clone(),
                            start: 0.0,
                            end: 0.0,
                        }]),
                    }
                }
                LoadedEngine::SherpaOffline(recognizer) => {
                    const SHERPA_SAMPLE_RATE: i32 = 16000;
                    debug!(
                        "Sherpa offline (local-only) input: {} samples @ {}Hz",
                        audio.len(),
                        SHERPA_SAMPLE_RATE
                    );

                    let _decode_guard = self.sherpa_offline_decode_lock.lock().unwrap();
                    let text = recognizer.decode(SHERPA_SAMPLE_RATE, &audio)?;

                    transcribe_rs::TranscriptionResult {
                        text: text.clone(),
                        segments: Some(vec![transcribe_rs::TranscriptionSegment {
                            text: text.clone(),
                            start: 0.0,
                            end: 0.0,
                        }]),
                    }
                }
            }
        };

        let et = std::time::Instant::now();
        info!(
            "Local-only transcription completed in {}ms",
            (et - st).as_millis()
        );

        let mut final_result = result.text.trim().to_string();

        if settings.punctuation_enabled && !final_result.is_empty() {
            let punct_model_id = settings.punctuation_model.trim();
            if !punct_model_id.is_empty() {
                let should_try = self
                    .model_manager
                    .get_model_info(punct_model_id)
                    .is_some_and(|m| m.is_downloaded);

                if should_try {
                    match self.apply_punctuation(punct_model_id, &final_result) {
                        Ok(punctuated) => {
                            if !punctuated.trim().is_empty() {
                                final_result = punctuated.trim().to_string();
                            }
                        }
                        Err(e) => {
                            warn!("Punctuation post-process failed: {}", e);
                        }
                    }
                }
            }
        }

        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
            if let Err(e) = self.unload_model() {
                error!("Failed to immediately unload model: {}", e);
            }
        }

        Ok(final_result)
    }

    fn apply_punctuation(&self, punct_model_id: &str, text: &str) -> Result<String> {
        let model_path = self.model_manager.get_model_path(punct_model_id)?;

        let prefer_int8 = self
            .model_manager
            .get_model_info(punct_model_id)
            .map(|m| m.filename.to_lowercase().contains("int8"))
            .unwrap_or(true);

        let model_file = find_sherpa_onnx(&model_path, "model", prefer_int8)?;
        let model_file = model_file.to_string_lossy().to_string();

        {
            let mut guard = self.punctuation.lock().unwrap();
            if let Some((loaded_id, punct)) = guard.as_ref() {
                if loaded_id == punct_model_id {
                    return punct.add_punct(text);
                }
            }

            let punct = SherpaOnnxOfflinePunctuation::new_ct_transformer(
                model_file,
                "cpu".to_string(),
                2,
                false,
            )?;
            let out = punct.add_punct(text)?;
            *guard = Some((punct_model_id.to_string(), punct));
            Ok(out)
        }
    }

    fn apply_punctuation_multiline(&self, punct_model_id: &str, text: &str) -> Result<String> {
        // Replace newlines with spaces to ensure the text is processed as a single line
        let single_line_text = text.replace('\n', " ");
        self.apply_punctuation(punct_model_id, &single_line_text)
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
