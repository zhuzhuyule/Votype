use super::post_process::{maybe_convert_chinese_variant, maybe_post_process_transcription};
use super::ShortcutAction;
use crate::active_window;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::model::{EngineType, ModelManager};
use crate::managers::transcription::{SherpaPartialEvent, TranscriptionManager};
use crate::overlay::{show_recording_overlay, show_transcribing_overlay};
use crate::settings::get_settings;
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils;
use log::{debug, error, info};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::sleep;

pub(super) struct TranscribeAction;

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        let ppm = app.state::<Arc<crate::managers::post_processing::PostProcessingManager>>();
        ppm.cancel_current_task();

        let settings_for_load = get_settings(app);
        if !settings_for_load.online_asr_enabled {
            let tm = app.state::<Arc<TranscriptionManager>>();
            tm.initiate_model_load();
        } else {
            debug!("Online ASR enabled: skip preloading local model");
        }

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        let rm = app.state::<Arc<AudioRecordingManager>>();
        rm.set_speech_frame_sender(None);
        rm.set_online_transcription_receiver(None);
        let mm = app.state::<Arc<ModelManager>>();

        let new_id = rm.increment_transcription_id();
        debug!("Starting new transcription session with ID: {}", new_id);

        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        // Online ASR can optionally run a secondary local model for realtime captions and for
        // post-processing fusion input.
        let use_secondary_local_realtime =
            settings.online_asr_enabled && settings.post_process_use_secondary_output;
        let secondary_local_model_id = if use_secondary_local_realtime {
            settings
                .post_process_secondary_model_id
                .clone()
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_else(|| settings.selected_model.clone())
        } else {
            String::new()
        };

        let secondary_use_sherpa_online = use_secondary_local_realtime
            && mm
                .get_model_info(&secondary_local_model_id)
                .map(|m| {
                    matches!(m.engine_type, EngineType::SherpaOnnx)
                        && m.filename.to_lowercase().contains("streaming")
                })
                .unwrap_or(false);

        let secondary_use_sherpa_offline = use_secondary_local_realtime
            && !secondary_use_sherpa_online
            && mm
                .get_model_info(&secondary_local_model_id)
                .map(|m| matches!(m.engine_type, EngineType::SherpaOnnx))
                .unwrap_or(false);

        let use_sherpa_online = !settings.online_asr_enabled
            && mm
                .get_model_info(&settings.selected_model)
                .map(|m| {
                    matches!(m.engine_type, EngineType::SherpaOnnx)
                        && m.filename.to_lowercase().contains("streaming")
                })
                .unwrap_or(false);

        // Check if we should use offline VAD streaming (for non-streaming Sherpa models)
        let use_sherpa_offline = !settings.online_asr_enabled
            && !use_sherpa_online
            && mm
                .get_model_info(&settings.selected_model)
                .map(|m| matches!(m.engine_type, EngineType::SherpaOnnx))
                .unwrap_or(false);

        if use_sherpa_online {
            let tm = (*app.state::<Arc<TranscriptionManager>>()).clone();
            let (frame_tx, frame_rx) = mpsc::channel::<Vec<f32>>();
            let (final_tx, final_rx) = mpsc::channel::<anyhow::Result<String>>();

            rm.set_speech_frame_sender(Some(frame_tx));
            rm.set_online_transcription_receiver(Some(final_rx));

            let app_handle = (*app).clone();
            std::thread::spawn(move || {
                let result = (|| -> anyhow::Result<String> {
                    tm.start_sherpa_online_session()?;
                    while let Ok(frame) = frame_rx.recv() {
                        tm.feed_sherpa_online_session(&frame)?;
                    }
                    tm.finish_sherpa_online_session()
                })();

                if let Err(e) = &result {
                    error!("Sherpa online transcription worker failed: {}", e);
                }
                let _ = app_handle.emit(
                    "sherpa-online-worker-exited",
                    serde_json::json!({ "ok": result.is_ok() }),
                );
                let _ = final_tx.send(result);
            });
        } else if secondary_use_sherpa_online {
            // Online ASR + secondary local streaming model (realtime captions only)
            let tm = (*app.state::<Arc<TranscriptionManager>>()).clone();
            let (frame_tx, frame_rx) = mpsc::channel::<Vec<f32>>();
            let (final_tx, final_rx) = mpsc::channel::<anyhow::Result<String>>();

            rm.set_speech_frame_sender(Some(frame_tx));
            rm.set_online_transcription_receiver(Some(final_rx));

            let app_handle = (*app).clone();
            let model_id = secondary_local_model_id.clone();
            std::thread::spawn(move || {
                let result = (|| -> anyhow::Result<String> {
                    tm.load_model(&model_id)?;
                    tm.start_sherpa_online_session()?;
                    while let Ok(frame) = frame_rx.recv() {
                        tm.feed_sherpa_online_session(&frame)?;
                    }
                    tm.finish_sherpa_online_session()
                })();

                if let Err(e) = &result {
                    error!("Secondary Sherpa online transcription worker failed: {}", e);
                }
                let _ = app_handle.emit(
                    "sherpa-online-worker-exited",
                    serde_json::json!({ "ok": result.is_ok() }),
                );
                let _ = final_tx.send(result);
            });
        } else if use_sherpa_offline {
            // Sherpa offline model with VAD streaming
            let tm = (*app.state::<Arc<TranscriptionManager>>()).clone();
            let (frame_tx, frame_rx) = mpsc::channel::<Vec<f32>>();
            let (final_tx, final_rx) = mpsc::channel::<anyhow::Result<String>>();

            rm.set_speech_frame_sender(Some(frame_tx));
            rm.set_online_transcription_receiver(Some(final_rx));

            let app_handle = (*app).clone();
            std::thread::spawn(move || {
                let result = (|| -> anyhow::Result<String> {
                    tm.start_sherpa_offline_session()?;

                    // Note: the audio pipeline emits *continuous* frames; when VAD reports
                    // non-speech it forwards a zeroed frame. Use those "silent" frames to
                    // drive the speech->silence transition logic.
                    loop {
                        match frame_rx.recv_timeout(Duration::from_millis(100)) {
                            Ok(frame) => {
                                let is_silence = frame.iter().all(|v| v.abs() <= 1e-7);
                                if is_silence {
                                    tm.check_sherpa_offline_silence()?;
                                    tm.maybe_force_sherpa_offline_partial()?;
                                } else {
                                    tm.feed_sherpa_offline_session(&frame)?;
                                    tm.maybe_force_sherpa_offline_partial()?;
                                }
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                // Check for silence timeout
                                tm.check_sherpa_offline_silence()?;
                                tm.maybe_force_sherpa_offline_partial()?;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                // Channel closed, finish session
                                break;
                            }
                        }
                    }

                    tm.finish_sherpa_offline_session()
                })();

                if let Err(e) = &result {
                    error!("Sherpa offline transcription worker failed: {}", e);
                }
                let _ = app_handle.emit(
                    "sherpa-offline-worker-exited",
                    serde_json::json!({ "ok": result.is_ok() }),
                );
                let _ = final_tx.send(result);
            });
        } else if secondary_use_sherpa_offline {
            // Online ASR + secondary local offline model with VAD streaming (realtime captions only)
            let tm = (*app.state::<Arc<TranscriptionManager>>()).clone();
            let (frame_tx, frame_rx) = mpsc::channel::<Vec<f32>>();
            let (final_tx, final_rx) = mpsc::channel::<anyhow::Result<String>>();

            rm.set_speech_frame_sender(Some(frame_tx));
            rm.set_online_transcription_receiver(Some(final_rx));

            let app_handle = (*app).clone();
            let model_id = secondary_local_model_id.clone();
            std::thread::spawn(move || {
                let result = (|| -> anyhow::Result<String> {
                    tm.load_model(&model_id)?;
                    tm.start_sherpa_offline_session()?;

                    loop {
                        match frame_rx.recv_timeout(Duration::from_millis(100)) {
                            Ok(frame) => {
                                let is_silence = frame.iter().all(|v| v.abs() <= 1e-7);
                                if is_silence {
                                    tm.check_sherpa_offline_silence()?;
                                    tm.maybe_force_sherpa_offline_partial()?;
                                } else {
                                    tm.feed_sherpa_offline_session(&frame)?;
                                    tm.maybe_force_sherpa_offline_partial()?;
                                }
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                tm.check_sherpa_offline_silence()?;
                                tm.maybe_force_sherpa_offline_partial()?;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                break;
                            }
                        }
                    }

                    tm.finish_sherpa_offline_session()
                })();

                if let Err(e) = &result {
                    error!("Secondary Sherpa offline transcription worker failed: {}", e);
                }
                let _ = app_handle.emit(
                    "sherpa-offline-worker-exited",
                    serde_json::json!({ "ok": result.is_ok() }),
                );
                let _ = final_tx.send(result);
            });
        }

        let mut recording_started = false;
        if is_always_on {
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            recording_started = rm.try_start_recording(&binding_id);
            debug!("Recording started: {}", recording_started);
        } else {
            let recording_start_time = Instant::now();
            if rm.try_start_recording(&binding_id) {
                recording_started = true;
                debug!("Recording started in {:?}", recording_start_time.elapsed());
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    debug!("Handling delayed audio feedback/mute sequence");
                    play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    rm_clone.apply_mute();
                });
            } else {
                debug!("Failed to start recording");
            }
        }

        if !recording_started
            && (use_sherpa_online
                || use_sherpa_offline
                || secondary_use_sherpa_online
                || secondary_use_sherpa_offline)
        {
            rm.set_speech_frame_sender(None);
            rm.set_online_transcription_receiver(None);
        }

        if recording_started {
            shortcut::register_cancel_shortcut(app);
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());
        let ppm = Arc::clone(
            &app.state::<Arc<crate::managers::post_processing::PostProcessingManager>>(),
        );

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        rm.remove_mute();
        play_feedback_sound(app, SoundType::Stop);

        let current_transcription_id = rm.get_current_transcription_id();
        let binding_id = binding_id.to_string();

        tauri::async_runtime::spawn(async move {
            debug!(
                "Starting async transcription task for binding: {} (ID: {})",
                binding_id, current_transcription_id
            );

            let stop_recording_time = Instant::now();
            if let Some(samples) = rm.stop_recording(&binding_id) {
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                let settings = get_settings(&ah);
                let duration_ms = (samples.len() as f64 / 16000.0 * 1000.0) as i64;

                let active_window_snapshot = active_window::fetch_active_window().ok();
                if let Some(info) = &active_window_snapshot {
                    debug!(
                        "Active window (snapshot): app='{}' title='{}' pid={} window_id={}",
                        info.app_name, info.title, info.process_id, info.window_id
                    );
                }

                let transcription_time = Instant::now();
                let had_streaming_worker = rm.take_online_transcription_receiver().is_some();
                let mut incremental_result: Option<String> = None;
                if had_streaming_worker {
                    // Cancel streaming/offline sessions so stop never waits on in-flight partial/final decode.
                    let r1 = tm.abort_sherpa_online_session();
                    let r2 = tm.abort_sherpa_offline_session();
                    incremental_result = r1.or(r2);
                }

                let use_parallel_online_secondary = settings.online_asr_enabled
                    && settings.post_process_enabled
                    && settings.post_process_use_secondary_output;

                // Always compute the final transcription from full audio on stop.
                // If online ASR is enabled and a secondary local candidate is requested for post-processing,
                // run the online request and the secondary local transcription concurrently.
                let (transcription_result, secondary_result): (
                    anyhow::Result<String>,
                    Option<String>,
                ) = if use_parallel_online_secondary {
                    let tm_for_primary = Arc::clone(&tm);
                    let samples_for_primary = samples.clone();

                    let incremental_for_secondary = incremental_result.clone();
                    let model_id_for_secondary = settings
                        .post_process_secondary_model_id
                        .as_ref()
                        .filter(|id| !id.trim().is_empty())
                        .cloned()
                        .unwrap_or_else(|| settings.selected_model.clone());
                    let tm_for_secondary = Arc::clone(&tm);
                    let samples_for_secondary = samples.clone();

                    let primary_handle = tokio::task::spawn_blocking(move || {
                        tm_for_primary.transcribe(samples_for_primary)
                    });

                    let secondary_handle =
                        tokio::task::spawn_blocking(move || -> Option<String> {
                            if let Some(text) = incremental_for_secondary {
                                if !text.trim().is_empty() {
                                    return Some(text);
                                }
                            }

                            if model_id_for_secondary.trim().is_empty() {
                                return None;
                            }

                            if let Err(e) = tm_for_secondary.load_model(&model_id_for_secondary) {
                                log::warn!(
                                    "Failed to load secondary model '{}': {}",
                                    model_id_for_secondary,
                                    e
                                );
                                return None;
                            }

                            match tm_for_secondary.transcribe_local_only(samples_for_secondary) {
                                Ok(local_text) => {
                                    if local_text.trim().is_empty() {
                                        None
                                    } else {
                                        Some(local_text)
                                    }
                                }
                                Err(e) => {
                                    log::warn!(
                                        "Failed to compute secondary local candidate: {}",
                                        e
                                    );
                                    None
                                }
                            }
                        });

                    let (primary_joined, secondary_joined) =
                        tokio::join!(primary_handle, secondary_handle);

                    let primary = match primary_joined {
                        Ok(res) => res,
                        Err(e) => Err(anyhow::anyhow!("Primary transcription task failed: {}", e)),
                    };
                    let secondary = match secondary_joined {
                        Ok(res) => res,
                        Err(e) => {
                            log::warn!("Secondary transcription task failed: {}", e);
                            None
                        }
                    };

                    (primary, secondary)
                } else {
                    (tm.transcribe(samples.clone()), None)
                };

                let mut primary_error: Option<String> = None;
                let mut primary_text: Option<String> = match transcription_result {
                    Ok(text) => {
                        let trimmed = text.trim().to_string();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed)
                        }
                    }
                    Err(err) => {
                        primary_error = Some(err.to_string());
                        None
                    }
                };

                // Fallback priority:
                // 1) primary transcription (online or local)
                // 2) secondary local transcription result (if enabled/available)
                // 3) incremental worker snapshot (if available)
                if primary_text.is_none() {
                    primary_text = secondary_result
                        .clone()
                        .filter(|t| !t.trim().is_empty())
                        .or_else(|| incremental_result.clone().filter(|t| !t.trim().is_empty()));
                }

                // Last-resort: if online ASR failed and we have any local model id, try a local-only transcription.
                if primary_text.is_none() && settings.online_asr_enabled {
                    let model_id = settings
                        .post_process_secondary_model_id
                        .as_ref()
                        .filter(|id| !id.trim().is_empty())
                        .cloned()
                        .unwrap_or_else(|| settings.selected_model.clone());
                    if !model_id.trim().is_empty() {
                        let tm_fallback = Arc::clone(&tm);
                        let samples_fallback = samples.clone();
                        match tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
                            tm_fallback.load_model(&model_id)?;
                            tm_fallback.transcribe_local_only(samples_fallback)
                        })
                        .await
                        {
                            Ok(Ok(local_text)) => {
                                if !local_text.trim().is_empty() {
                                    primary_text = Some(local_text.trim().to_string());
                                }
                            }
                            Ok(Err(e)) => {
                                log::warn!("Local fallback transcription failed: {}", e);
                            }
                            Err(e) => {
                                log::warn!("Local fallback task failed: {}", e);
                            }
                        }
                    }
                }

                let transcription_ms = transcription_time.elapsed().as_millis() as i64;

                if let Some(transcription) = primary_text.clone() {
                    debug!(
                        "Transcription completed in {:?}: '{}'",
                        transcription_time.elapsed(),
                        transcription
                    );

                    // If we canceled a streaming/offline Sherpa worker on stop, it won't
                    // emit the final partial event. Emit a final payload here so the overlay
                    // shows the completed text (useful for long offline VAD streaming).
                    if tm.is_current_sherpa_offline() {
                        let punctuated_text =
                            settings.punctuation_enabled.then(|| transcription.clone());
                        let _ = ah.emit(
                            "sherpa-offline-partial",
                            SherpaPartialEvent {
                                text: transcription.clone(),
                                punctuated_text,
                                is_final: true,
                            },
                        );
                    } else if tm.is_current_sherpa_online() {
                        let punctuated_text =
                            settings.punctuation_enabled.then(|| transcription.clone());
                        let _ = ah.emit(
                            "sherpa-online-partial",
                            SherpaPartialEvent {
                                text: transcription.clone(),
                                punctuated_text,
                                is_final: true,
                            },
                        );
                    }

                    let transcription_clone = transcription.clone();
                    let samples_clone = samples.clone();

                    let asr_model = if settings.online_asr_enabled {
                        settings
                            .selected_asr_model_id
                            .clone()
                            .unwrap_or_else(|| "online".to_string())
                    } else {
                        settings.selected_model.clone()
                    };

                    let history_id = match hm
                        .save_transcription(
                            samples_clone,
                            transcription.clone(),
                            None,
                            None,
                            Some(duration_ms),
                            Some(transcription_ms),
                            Some(settings.selected_language.clone()),
                            Some(asr_model),
                            active_window_snapshot
                                .as_ref()
                                .map(|info| info.app_name.clone()),
                            active_window_snapshot
                                .as_ref()
                                .map(|info| info.title.clone()),
                        )
                        .await
                    {
                        Ok(id) => Some(id),
                        Err(e) => {
                            error!("Failed to save transcription to history: {}", e);
                            None
                        }
                    };

                            if rm.get_current_transcription_id() != current_transcription_id {
                                info!(
                                    "New recording started during transcription (ID mismatch: {} != {}). Skipping paste/post-processing.",
                                    rm.get_current_transcription_id(),
                                    current_transcription_id
                                );
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                                return;
                            }

                            if settings.post_process_enabled {
                                let ah_clone = ah.clone();
                                let settings_clone = settings.clone();
                                let rm_clone = Arc::clone(&rm);
                                let hm_clone = Arc::clone(&hm);
                                let ppm_clone = Arc::clone(&ppm);
                                let secondary_result_for_post = secondary_result.clone();
                                let incremental_result_for_post = incremental_result.clone();

                                let task = tokio::spawn(async move {
                                    let mut final_text = transcription_clone.clone();
                                    let mut post_process_prompt = String::new();

                                    if let Some(converted_text) = maybe_convert_chinese_variant(
                                        &settings_clone,
                                        &transcription_clone,
                                    )
                                    .await
                                    {
                                        final_text = converted_text;
                                    } else if let Some(processed_text) = {
                                            let secondary = if settings_clone
                                                .post_process_use_secondary_output
                                            {
                                                let mut secondary = secondary_result_for_post
                                                    .clone()
                                                    .or_else(|| incremental_result_for_post.clone());
                                                if secondary.is_none() {
                                                    secondary = Some(transcription_clone.clone());
                                                }
                                                secondary
                                            } else {
                                                None
                                            };

                                            maybe_post_process_transcription(
                                                &ah_clone,
                                                &settings_clone,
                                                &transcription_clone,
                                                secondary.as_deref(),
                                                true,
                                            )
                                            .await
                                        } {
                                        final_text = processed_text;

                                        if let Some(prompt_id) =
                                            &settings_clone.post_process_selected_prompt_id
                                        {
                                            if let Some(prompt) = settings_clone
                                                .post_process_prompts
                                                .iter()
                                                .find(|p| &p.id == prompt_id)
                                            {
                                                post_process_prompt = prompt.prompt.clone();
                                            }
                                        }
                                    }

                                    if let Some(history_id) = history_id {
                                        let prompt_to_store = post_process_prompt.clone();
                                        if let Err(e) = hm_clone
                                            .update_transcription_post_processing(
                                                history_id,
                                                final_text.clone(),
                                                prompt_to_store,
                                            )
                                            .await
                                        {
                                            error!(
                                                "Failed to update transcription with post-processing: {}",
                                                e
                                            );
                                        }
                                    }

                                    if rm_clone.get_current_transcription_id()
                                        != current_transcription_id
                                    {
                                        info!("New recording started during post-processing; skipping paste.");
                                        utils::hide_recording_overlay(&ah_clone);
                                        change_tray_icon(&ah_clone, TrayIconState::Idle);
                                        return;
                                    }

                                    let ah_clone_inner = ah_clone.clone();
                                    ah_clone
                                        .run_on_main_thread(move || {
                                            utils::hide_recording_overlay(&ah_clone_inner);
                                            change_tray_icon(&ah_clone_inner, TrayIconState::Idle);
                                            if let Err(e) = utils::paste(final_text, ah_clone_inner)
                                            {
                                                error!("Failed to paste transcription: {}", e);
                                            }
                                        })
                                        .unwrap_or_else(|e| {
                                            error!("Failed to run paste on main thread: {:?}", e)
                                        });
                                });

                                ppm_clone.set_current_task(task.abort_handle());
                            } else {
                                let ah_clone = ah.clone();
                                ah.run_on_main_thread(move || {
                                    utils::hide_recording_overlay(&ah_clone);
                                    change_tray_icon(&ah_clone, TrayIconState::Idle);
                                    if let Err(e) = utils::paste(transcription_clone, ah_clone) {
                                        error!("Failed to paste transcription: {}", e);
                                    }
                                })
                                .unwrap_or_else(|e| {
                                    error!("Failed to run paste on main thread: {:?}", e)
                                });
                            }
                } else {
                    let err_msg = primary_error.unwrap_or_else(|| "unknown".to_string());
                    debug!("Global Shortcut Transcription error: {}", err_msg);

                    // Save the audio even when transcription fails, so users can retry later.
                    let asr_model = if settings.online_asr_enabled {
                        settings
                            .selected_asr_model_id
                            .clone()
                            .unwrap_or_else(|| "online".to_string())
                    } else {
                        settings.selected_model.clone()
                    };
                    let failure_text = format!("[Transcription failed] {}", err_msg);
                    if let Err(e) = hm
                        .save_transcription(
                            samples.clone(),
                            failure_text,
                            None,
                            None,
                            Some(duration_ms),
                            Some(transcription_ms),
                            Some(settings.selected_language.clone()),
                            Some(asr_model),
                            active_window_snapshot
                                .as_ref()
                                .map(|info| info.app_name.clone()),
                            active_window_snapshot
                                .as_ref()
                                .map(|info| info.title.clone()),
                        )
                        .await
                    {
                        error!("Failed to save failed transcription to history: {}", e);
                    }

                    let _ = ah.emit(
                        "overlay-error",
                        serde_json::json!({
                            "code": "transcription_failed_saved",
                        }),
                    );

                    // Give the user a moment to see the failure state, then close the overlay.
                    sleep(Duration::from_millis(2500)).await;
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                }
            } else {
                debug!("No samples retrieved from recording stop");
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}
