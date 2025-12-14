use super::post_process::{maybe_convert_chinese_variant, maybe_post_process_transcription};
use super::ShortcutAction;
use crate::active_window;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::model::{EngineType, ModelManager};
use crate::managers::transcription::TranscriptionManager;
use crate::overlay::{show_recording_overlay, show_transcribing_overlay};
use crate::settings::get_settings;
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils;
use log::{debug, error, info};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

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

        let use_sherpa_online = !settings.online_asr_enabled
            && mm
                .get_model_info(&settings.selected_model)
                .map(|m| {
                    matches!(m.engine_type, EngineType::SherpaOnnx)
                        && m.filename.to_lowercase().contains("streaming")
                })
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

        if !recording_started && use_sherpa_online {
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

                let transcription_time = Instant::now();
                let samples_clone = samples.clone();
                let transcription_result = if let Some(rx) = rm.take_online_transcription_receiver()
                {
                    match rx.recv_timeout(Duration::from_secs(30)) {
                        Ok(res) => res,
                        Err(err) => Err(anyhow::anyhow!(
                            "Timed out waiting for Sherpa online transcription: {}",
                            err
                        )),
                    }
                } else {
                    tm.transcribe(samples_clone)
                };

                match transcription_result {
                    Ok(transcription) => {
                        debug!(
                            "Transcription completed in {:?}: '{}'",
                            transcription_time.elapsed(),
                            transcription
                        );
                        if !transcription.is_empty() {
                            let active_window_snapshot = active_window::fetch_active_window().ok();
                            if let Some(info) = &active_window_snapshot {
                                debug!(
                                    "Active window: app='{}' title='{}' pid={} window_id={}",
                                    info.app_name, info.title, info.process_id, info.window_id
                                );
                            }

                            let settings = get_settings(&ah);
                            let transcription_clone = transcription.clone();
                            let samples_clone = samples.clone();

                            let duration_ms =
                                (samples_clone.len() as f64 / 16000.0 * 1000.0) as i64;

                            let history_id = match hm
                                .save_transcription(
                                    samples_clone,
                                    transcription.clone(),
                                    None,
                                    None,
                                    Some(duration_ms),
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
                                    } else if let Some(processed_text) =
                                        maybe_post_process_transcription(
                                            &ah_clone,
                                            &settings_clone,
                                            &transcription_clone,
                                        )
                                        .await
                                    {
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
                            utils::hide_recording_overlay(&ah);
                            change_tray_icon(&ah, TrayIconState::Idle);
                        }
                    }
                    Err(err) => {
                        debug!("Global Shortcut Transcription error: {}", err);
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                    }
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
