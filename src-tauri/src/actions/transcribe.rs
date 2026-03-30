use super::post_process::maybe_convert_chinese_variant;
use super::ShortcutAction;
use crate::active_window;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::model::ModelManager;
use crate::managers::transcription::TranscriptionManager;
use crate::overlay::{show_recording_overlay, show_transcribing_overlay};
use crate::settings::get_settings;
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils;
use crate::window_context::VotypeInputMode;
use log::{debug, error, info};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, timeout};

pub(super) struct TranscribeAction {
    pub skill_mode: bool,
}

impl TranscribeAction {
    pub fn new(skill_mode: bool) -> Self {
        Self { skill_mode }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ScriptType {
    Latin,
    Han,
    Other,
}

#[derive(Clone, Debug)]
struct DiffToken {
    normalized: String,
    script: ScriptType,
}

fn detect_script(value: &str) -> ScriptType {
    if value
        .chars()
        .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
    {
        return ScriptType::Han;
    }
    if value.chars().any(|ch| ch.is_ascii_alphabetic()) {
        return ScriptType::Latin;
    }
    ScriptType::Other
}

fn tokenize_diff_words(text: &str) -> Vec<DiffToken> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ('\u{4e00}'..='\u{9fff}').contains(&ch) {
            if !current.is_empty() {
                let raw = std::mem::take(&mut current);
                tokens.push(DiffToken {
                    normalized: raw.to_lowercase(),
                    script: detect_script(&raw),
                });
            }
            let raw = ch.to_string();
            tokens.push(DiffToken {
                normalized: raw.clone(),
                script: detect_script(&raw),
            });
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                let raw = std::mem::take(&mut current);
                tokens.push(DiffToken {
                    normalized: raw.to_lowercase(),
                    script: detect_script(&raw),
                });
            }
            continue;
        }
        if ch.is_alphanumeric() {
            current.push(ch);
        } else {
            if !current.is_empty() {
                let raw = std::mem::take(&mut current);
                tokens.push(DiffToken {
                    normalized: raw.to_lowercase(),
                    script: detect_script(&raw),
                });
            }
            let raw = ch.to_string();
            tokens.push(DiffToken {
                normalized: raw.clone(),
                script: detect_script(&raw),
            });
        }
    }
    if !current.is_empty() {
        let raw = current;
        tokens.push(DiffToken {
            normalized: raw.to_lowercase(),
            script: detect_script(&raw),
        });
    }
    tokens
}

fn count_sentence_markers(text: &str) -> usize {
    let mut count = 0usize;
    for ch in text.chars() {
        if matches!(ch, '。' | '！' | '？' | '.' | '!' | '?') {
            count += 1;
        }
    }
    if count == 0 && !text.trim().is_empty() {
        1
    } else {
        count
    }
}

fn compute_change_percent(source: &str, target: &str) -> u8 {
    let source_tokens = tokenize_diff_words(source);
    let target_tokens = tokenize_diff_words(target);
    let source_len = source_tokens.len();
    let target_len = target_tokens.len();
    let max_len = source_len.max(target_len);
    if max_len == 0 {
        return 0;
    }

    let mut dp = vec![vec![0usize; target_len + 1]; source_len + 1];
    for i in 1..=source_len {
        for j in 1..=target_len {
            if source_tokens[i - 1].normalized == target_tokens[j - 1].normalized {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }

    let lcs = dp[source_len][target_len];
    let edits = max_len.saturating_sub(lcs);

    let mut i = source_len;
    let mut j = target_len;
    let mut pending_deletes: Vec<DiffToken> = Vec::new();
    let mut script_switches = 0usize;
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && source_tokens[i - 1].normalized == target_tokens[j - 1].normalized {
            pending_deletes.clear();
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            if let Some(prev) = pending_deletes.pop() {
                let current = &target_tokens[j - 1];
                if prev.script != ScriptType::Other
                    && current.script != ScriptType::Other
                    && prev.script != current.script
                {
                    script_switches += 1;
                }
            }
            j -= 1;
        } else if i > 0 {
            pending_deletes.push(source_tokens[i - 1].clone());
            i -= 1;
        }
    }

    let token_change_rate = edits as f64 / max_len as f64;
    let script_switch_rate = script_switches as f64 / max_len as f64;
    let source_sentences = count_sentence_markers(source);
    let target_sentences = count_sentence_markers(target);
    let sentence_change_rate = if source_sentences == 0 && target_sentences == 0 {
        0.0
    } else {
        ((source_sentences as i64 - target_sentences as i64).unsigned_abs() as f64)
            / (source_sentences.max(target_sentences) as f64)
    };

    let score = 0.6 * token_change_rate + 0.3 * script_switch_rate + 0.1 * sentence_change_rate;
    let percent = (score * 100.0).round() as i32;
    percent.clamp(0, 100) as u8
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        let ppm = app.state::<Arc<crate::managers::post_processing::PostProcessingManager>>();
        ppm.cancel_current_task();

        let settings_for_load = get_settings(app);

        // Realtime preview should be available whenever the current recording flow
        // has a local model path that can produce partial text.
        // - Local ASR: always enable realtime preview
        // - Online ASR: enable only when a secondary local candidate is configured
        let enable_realtime = settings_for_load.realtime_transcription_enabled
            && (!settings_for_load.online_asr_enabled
                || settings_for_load.post_process_use_secondary_output);

        let rm = app.state::<Arc<AudioRecordingManager>>();

        if !settings_for_load.online_asr_enabled || enable_realtime {
            let tm = app.state::<Arc<TranscriptionManager>>();
            tm.initiate_model_load();
        } else {
            debug!("Online ASR enabled: skip preloading local model");
        }

        // Pre-load VAD in parallel with ASR model
        {
            let rm_clone = Arc::clone(&rm);
            std::thread::spawn(move || {
                if let Err(e) = rm_clone.preload_vad() {
                    log::debug!("VAD pre-load failed (will retry on stream open): {}", e);
                }
            });
        }

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        // Setup channel for receiving audio frames for realtime simulation if using local model
        let (realtime_tx, realtime_rx) = std::sync::mpsc::channel::<Vec<f32>>();
        if enable_realtime {
            rm.set_speech_frame_sender(Some(realtime_tx));
        } else {
            rm.set_speech_frame_sender(None);
        }

        rm.set_online_transcription_receiver(None);
        let _mm = app.state::<Arc<ModelManager>>();

        let new_id = rm.increment_transcription_id();
        debug!("Starting new transcription session with ID: {}", new_id);

        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        // Online ASR can optionally run a secondary local model for realtime captions and for
        // post-processing fusion input.
        let use_secondary_local_realtime =
            settings.online_asr_enabled && settings.post_process_use_secondary_output;
        let _secondary_local_model_id = if use_secondary_local_realtime {
            settings
                .post_process_secondary_model_id
                .clone()
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_default()
        } else {
            String::new()
        };

        let mut recording_started = false;
        if is_always_on {
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            recording_started = rm.try_start_recording(&binding_id, 0);
            debug!("Recording started: {}", recording_started);
        } else {
            let recording_start_time = Instant::now();
            if rm.try_start_recording(&binding_id, 0) {
                recording_started = true;
                debug!("Recording started in {:?}", recording_start_time.elapsed());
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    rm_clone.apply_mute();
                });
            } else {
                debug!("Failed to start recording");
            }
        }

        if recording_started {
            shortcut::register_cancel_shortcut(app);

            if enable_realtime {
                let tm_realtime = app.state::<Arc<TranscriptionManager>>().inner().clone();
                let app_handle_realtime = app.clone();
                let interval_ms = settings_for_load.offline_vad_force_interval_ms;
                let window_secs = settings_for_load.offline_vad_force_window_seconds;

                // Pre-load punct model in background so anchored punctuation is ready
                let tm_punct = tm_realtime.clone();
                std::thread::spawn(move || {
                    tm_punct.ensure_punct_model_loaded();
                });

                std::thread::spawn(move || {
                    realtime_worker_loop(
                        realtime_rx,
                        &tm_realtime,
                        &app_handle_realtime,
                        interval_ms,
                        window_secs,
                    );
                });
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
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

        // Drop the speech frame sender so the realtime worker exits
        // before the final transcription grabs the engine.
        rm.set_speech_frame_sender(None);

        rm.remove_mute();
        play_feedback_sound(app, SoundType::Stop);

        let current_transcription_id = rm.get_current_transcription_id();
        let binding_id = binding_id.to_string();
        let shortcut_str = shortcut_str.to_string();
        let review_editor_active = shortcut_str == "review-window-local"
            && crate::review_window::is_review_editor_active();
        let skill_mode = self.skill_mode;
        let ppm_outer = Arc::clone(&ppm);

        let pipeline_handle = tauri::async_runtime::spawn(async move {
            // RAII guard that fires on every exit path of this async block —
            // whether it returns normally, is aborted, or panics.
            struct FinishGuard {
                app: AppHandle,
                transcription_id: u64,
            }
            impl Drop for FinishGuard {
                fn drop(&mut self) {
                    let rm = self.app.state::<Arc<AudioRecordingManager>>();
                    if rm.get_current_transcription_id() == self.transcription_id {
                        shortcut::unregister_cancel_shortcut(&self.app);
                    }

                    // Always notify coordinator that processing is done
                    if let Some(coordinator) =
                        self.app.try_state::<crate::transcription_coordinator::TranscriptionCoordinator>()
                    {
                        coordinator.notify_processing_finished();
                    }

                    // Clean up UI state
                    utils::hide_recording_overlay(&self.app);
                    change_tray_icon(&self.app, TrayIconState::Idle);
                }
            }
            let _finish_guard = FinishGuard {
                app: ah.clone(),
                transcription_id: current_transcription_id,
            };

            debug!(
                "Starting async transcription task for binding: {} (ID: {})",
                binding_id, current_transcription_id
            );

            let stop_recording_time = Instant::now();
            if let Some(samples) = rm.stop_recording(&binding_id) {
                // If samples are very short (e.g., < 0.3s), likely no speech, so skip transcription.
                if samples.len() < 4800 {
                    debug!(
                        "Recording too short or empty ({} samples), skipping transcription and error.",
                        samples.len()
                    );
                    return;
                }

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
                let selected_text = crate::clipboard::get_selected_text(&ah).ok();
                let review_document_text = if shortcut_str == "review-window-local" {
                    crate::review_window::take_frozen_review_editor_content()
                        .or_else(crate::review_window::current_review_editor_content)
                } else {
                    None
                };
                let votype_mode = if shortcut_str == "review-window-local" {
                    VotypeInputMode::ReviewRewrite
                } else {
                    crate::window_context::resolve_votype_input_mode(
                        active_window_snapshot
                            .as_ref()
                            .map(|info| info.app_name.as_str()),
                        active_window_snapshot
                            .as_ref()
                            .map(|info| info.title.as_str()),
                        review_editor_active,
                        selected_text
                            .as_ref()
                            .map(|text| !text.trim().is_empty())
                            .unwrap_or(false),
                    )
                };

                // Capture selected text for Mode C (auto-routing)
                // [DEBUG] Log selected text at recording stop
                match &selected_text {
                    Some(text) if !text.trim().is_empty() => {
                        let preview: String = text.chars().take(100).collect();
                        let suffix = if text.chars().count() > 100 {
                            "..."
                        } else {
                            ""
                        };
                        info!(
                            "[Selection] Recording stopped - captured {} chars: \"{}{}\"",
                            text.len(),
                            preview,
                            suffix
                        );
                    }
                    Some(_) => {
                        info!("[Selection] Recording stopped - captured text is empty/whitespace only");
                    }
                    None => {
                        info!("[Selection] Recording stopped - no text captured (get_selected_text returned None)");
                    }
                }

                // Pre-save audio with empty placeholder so the recording is preserved
                // even if the pipeline is aborted during transcription/post-processing.
                let asr_model_for_presave = if settings.online_asr_enabled {
                    settings
                        .selected_asr_model_id
                        .clone()
                        .unwrap_or_else(|| "online".to_string())
                } else {
                    settings.selected_model.clone()
                };
                let streaming_asr_model_for_presave =
                    if settings.online_asr_enabled && settings.post_process_use_secondary_output {
                        settings
                            .post_process_secondary_model_id
                            .clone()
                            .or(Some(settings.selected_model.clone()))
                    } else if !settings.online_asr_enabled {
                        Some(settings.selected_model.clone())
                    } else {
                        None
                    };
                let presave_history_id = match hm
                    .save_transcription(
                        samples.clone(),
                        String::new(), // empty placeholder
                        None,
                        streaming_asr_model_for_presave,
                        None,
                        None,
                        None,
                        None,
                        Some(duration_ms),
                        None, // transcription_ms not known yet
                        Some(settings.selected_language.clone()),
                        Some(asr_model_for_presave),
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
                        error!("Failed to pre-save audio to history: {}", e);
                        None
                    }
                };

                let transcription_time = Instant::now();
                // Streaming workers no longer exist without Sherpa
                let incremental_result: Option<String> = None;

                let use_parallel_online_secondary = settings.online_asr_enabled
                    && settings.post_process_enabled
                    && settings.post_process_use_secondary_output;

                // Always compute the final transcription from full audio on stop.
                // If online ASR is enabled, use OnlineAsrClient for the primary transcription.
                // If a secondary local candidate is also requested, run both concurrently.
                let (transcription_result, secondary_result): (
                    anyhow::Result<String>,
                    Option<String>,
                ) = if settings.online_asr_enabled {
                    // --- Online ASR primary ---
                    use crate::online_asr::OnlineAsrClient;

                    let online_model_id = settings
                        .selected_asr_model_id
                        .clone()
                        .unwrap_or_else(|| "online".to_string());

                    let cached_model = settings
                        .cached_models
                        .iter()
                        .find(|m| {
                            m.model_type == crate::settings::ModelType::Asr
                                && m.id == online_model_id
                        })
                        .cloned();

                    let samples_for_online = samples.clone();
                    let language = settings.selected_language.clone();

                    let primary_handle = if let Some(cached) = cached_model {
                        let provider_info = settings
                            .post_process_providers
                            .iter()
                            .find(|p| p.id == cached.provider_id)
                            .cloned();
                        let api_key = settings
                            .post_process_api_keys
                            .get(&cached.provider_id)
                            .cloned();
                        let remote_model_id = cached.model_id.clone();

                        tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
                            let provider = provider_info
                                .ok_or_else(|| anyhow::anyhow!("Online ASR provider not found"))?;
                            let client =
                                OnlineAsrClient::new(16000, std::time::Duration::from_secs(120));
                            let lang = if language == "auto" {
                                None
                            } else {
                                Some(language.as_str())
                            };
                            client.transcribe(
                                &provider,
                                api_key,
                                &remote_model_id,
                                lang,
                                &samples_for_online,
                            )
                        })
                    } else {
                        // No cached model found, fall back to local
                        let tm_fallback = Arc::clone(&tm);
                        tokio::task::spawn_blocking(move || {
                            tm_fallback.transcribe(samples_for_online)
                        })
                    };

                    // --- Optional secondary local candidate ---
                    let secondary_handle = if use_parallel_online_secondary {
                        let incremental_for_secondary = incremental_result.clone();
                        let model_id_for_secondary = settings
                            .post_process_secondary_model_id
                            .as_ref()
                            .filter(|id| !id.trim().is_empty())
                            .cloned()
                            .unwrap_or_default();
                        let tm_for_secondary = Arc::clone(&tm);
                        let samples_for_secondary = samples.clone();

                        Some(tokio::task::spawn_blocking(move || -> Option<String> {
                            if let Some(text) = incremental_for_secondary {
                                if !text.trim().is_empty() {
                                    return Some(text);
                                }
                            }

                            if model_id_for_secondary.trim().is_empty() {
                                return None;
                            }

                            // Only load if a different model is needed; skip if already loaded
                            let needs_load = tm_for_secondary
                                .get_current_model()
                                .map_or(true, |current| current != model_id_for_secondary);
                            if needs_load {
                                if let Err(e) = tm_for_secondary.load_model(&model_id_for_secondary)
                                {
                                    log::warn!(
                                        "Failed to load secondary model '{}': {}",
                                        model_id_for_secondary,
                                        e
                                    );
                                    return None;
                                }
                            }

                            match tm_for_secondary.transcribe(samples_for_secondary) {
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
                        }))
                    } else {
                        None
                    };

                    // Cache model info for potential retry in online-only timeout path
                    let cached_model_for_retry = settings
                        .cached_models
                        .iter()
                        .find(|m| {
                            m.model_type == crate::settings::ModelType::Asr
                                && Some(&m.id) == settings.selected_asr_model_id.as_ref()
                        })
                        .cloned();

                    // Determine if we have a local fallback running in parallel
                    let has_local_fallback = secondary_handle.is_some();
                    // 10s chosen as reasonable upper bound for network ASR latency;
                    // the internal HTTP client timeout is 120s.
                    const ONLINE_TIMEOUT_WITH_LOCAL: u64 = 10;

                    if has_local_fallback {
                        // Race: wait up to 10s for online, otherwise use local
                        let secondary_handle = secondary_handle.unwrap();

                        match timeout(
                            Duration::from_secs(ONLINE_TIMEOUT_WITH_LOCAL),
                            primary_handle,
                        )
                        .await
                        {
                            Ok(join_result) => {
                                // Online finished within timeout
                                let primary = match join_result {
                                    Ok(res) => res,
                                    Err(e) => Err(anyhow::anyhow!("Online ASR task failed: {}", e)),
                                };
                                // Still await secondary (it's likely done or almost done)
                                let secondary = match secondary_handle.await {
                                    Ok(res) => res,
                                    Err(e) => {
                                        log::warn!("Secondary transcription task failed: {}", e);
                                        None
                                    }
                                };
                                (primary, secondary)
                            }
                            Err(_elapsed) => {
                                // Online timed out — use local result.
                                // Note: dropping primary_handle does NOT cancel the blocking thread;
                                // the online request continues until its internal 120s HTTP timeout.
                                log::warn!(
                                    "[ASR] Online timeout ({}s), using local result",
                                    ONLINE_TIMEOUT_WITH_LOCAL
                                );
                                // Await the secondary (local) result — local transcription is expected
                                // to be fast (sub-second) so no additional timeout is applied here.
                                let secondary = match secondary_handle.await {
                                    Ok(res) => res,
                                    Err(e) => {
                                        log::warn!("Secondary transcription task failed: {}", e);
                                        None
                                    }
                                };
                                // Return online as error so fallback logic picks up secondary
                                (
                                    Err(anyhow::anyhow!(
                                        "Online ASR timed out after {}s, fell back to local",
                                        ONLINE_TIMEOUT_WITH_LOCAL
                                    )),
                                    secondary,
                                )
                            }
                        }
                    } else {
                        // No local fallback — online-only mode with 30s timeout prompt
                        const ONLINE_TIMEOUT_NO_LOCAL: u64 = 30;

                        match timeout(Duration::from_secs(ONLINE_TIMEOUT_NO_LOCAL), primary_handle)
                            .await
                        {
                            Ok(join_result) => {
                                let primary = match join_result {
                                    Ok(res) => res,
                                    Err(e) => Err(anyhow::anyhow!("Online ASR task failed: {}", e)),
                                };
                                (primary, None)
                            }
                            Err(_elapsed) => {
                                log::warn!(
                                    "[ASR] Online-only ASR timed out after {}s, prompting user",
                                    ONLINE_TIMEOUT_NO_LOCAL
                                );
                                let _ = ah.emit(
                                    "asr-online-timeout",
                                    serde_json::json!({
                                        "has_local_fallback": false
                                    }),
                                );

                                // Wait for user decision via oneshot channel
                                let (tx, rx) = tokio::sync::oneshot::channel::<String>();
                                {
                                    let state = ah.state::<crate::AsrTimeoutResponseSender>();
                                    let mut guard = state.lock().unwrap_or_else(|e| e.into_inner());
                                    *guard = Some(tx);
                                }

                                // Give user up to 120s to respond; auto-cancel if no response
                                match timeout(Duration::from_secs(120), rx).await {
                                    Err(_elapsed) => {
                                        log::warn!("[ASR] User did not respond to timeout prompt within 120s, auto-cancelling");
                                        (
                                            Err(anyhow::anyhow!("ASR timeout: no user response")),
                                            None,
                                        )
                                    }
                                    Ok(channel_result) => match channel_result {
                                        Ok(action) => match action.as_str() {
                                            "continue" | "retry" => {
                                                log::info!(
                                                    "[ASR] User chose to {} online ASR",
                                                    action
                                                );
                                                // Re-send the online ASR request (original handle was consumed by timeout)
                                                if let Some(cached) =
                                                    cached_model_for_retry.as_ref()
                                                {
                                                    let provider_info = settings
                                                        .post_process_providers
                                                        .iter()
                                                        .find(|p| p.id == cached.provider_id)
                                                        .cloned();
                                                    let api_key = settings
                                                        .post_process_api_keys
                                                        .get(&cached.provider_id)
                                                        .cloned();
                                                    let remote_model_id = cached.model_id.clone();
                                                    let language =
                                                        settings.selected_language.clone();
                                                    let samples_retry = samples.clone();

                                                    let retry_handle = tokio::task::spawn_blocking(
                                                        move || -> anyhow::Result<String> {
                                                            let provider = provider_info
                                                                .ok_or_else(|| {
                                                                    anyhow::anyhow!(
                                                                    "Online ASR provider not found"
                                                                )
                                                                })?;
                                                            let client = OnlineAsrClient::new(
                                                                16000,
                                                                Duration::from_secs(120),
                                                            );
                                                            let lang = if language == "auto" {
                                                                None
                                                            } else {
                                                                Some(language.as_str())
                                                            };
                                                            client.transcribe(
                                                                &provider,
                                                                api_key,
                                                                &remote_model_id,
                                                                lang,
                                                                &samples_retry,
                                                            )
                                                        },
                                                    );
                                                    let primary = match retry_handle.await {
                                                        Ok(res) => res,
                                                        Err(e) => Err(anyhow::anyhow!(
                                                            "Online ASR {} failed: {}",
                                                            action,
                                                            e
                                                        )),
                                                    };
                                                    (primary, None)
                                                } else {
                                                    (
                                                        Err(anyhow::anyhow!(
                                                            "No cached model for retry"
                                                        )),
                                                        None,
                                                    )
                                                }
                                            }
                                            _ => {
                                                // "cancel" or unknown
                                                log::info!("[ASR] User cancelled online ASR");
                                                (
                                                    Err(anyhow::anyhow!(
                                                        "User cancelled online ASR"
                                                    )),
                                                    None,
                                                )
                                            }
                                        },
                                        Err(_) => {
                                            log::warn!(
                                            "[ASR] Timeout response channel dropped, cancelling"
                                        );
                                            (
                                                Err(anyhow::anyhow!(
                                                    "ASR timeout response channel dropped"
                                                )),
                                                None,
                                            )
                                        }
                                    },
                                }
                            }
                        }
                    }
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
                            tm_fallback.transcribe(samples_fallback)
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
                let _streaming_text = secondary_result
                    .clone()
                    .or_else(|| incremental_result.clone())
                    .filter(|t| !t.trim().is_empty());

                if let Some(transcription) = primary_text.clone() {
                    debug!(
                        "Transcription completed in {:?}: '{}'",
                        transcription_time.elapsed(),
                        transcription
                    );

                    let transcription_clone = transcription.clone();

                    let asr_model = if settings.online_asr_enabled {
                        settings
                            .selected_asr_model_id
                            .clone()
                            .unwrap_or_else(|| "online".to_string())
                    } else {
                        settings.selected_model.clone()
                    };

                    // Update the pre-saved placeholder with actual transcription content
                    let history_id = if let Some(pid) = presave_history_id {
                        let char_count = transcription.chars().count() as i64;
                        if let Err(e) = hm
                            .update_transcription_content(
                                pid,
                                transcription.clone(),
                                asr_model,
                                settings.selected_language.clone(),
                                duration_ms,
                                transcription_ms,
                                char_count,
                            )
                            .await
                        {
                            error!("Failed to update transcription content: {}", e);
                        }
                        Some(pid)
                    } else {
                        None
                    };

                    if rm.get_current_transcription_id() != current_transcription_id {
                        info!(
                                    "New recording started during transcription (ID mismatch: {} != {}). Skipping paste/post-processing.",
                                    rm.get_current_transcription_id(),
                                    current_transcription_id
                                );
                        return;
                    }

                    if settings.post_process_enabled {
                        let ah_clone = ah.clone();
                        let settings_clone = settings.clone();
                        let rm_clone = Arc::clone(&rm);
                        let hm_clone = Arc::clone(&hm);
                        let secondary_result_for_post = secondary_result.clone();
                        let incremental_result_for_post = incremental_result.clone();

                        let mut active_window_snapshot_for_review = active_window_snapshot.clone();
                        if shortcut_str == "review-window-local" {
                            if let Some(info) = active_window_snapshot_for_review.as_mut() {
                                info.app_name = "Votype".to_string();
                                info.title = "Votype Review".to_string();
                            } else {
                                active_window_snapshot_for_review =
                                    Some(crate::active_window::ActiveWindowInfo {
                                        title: "Votype Review".to_string(),
                                        app_name: "Votype".to_string(),
                                        window_id: "review_window".to_string(),
                                        process_id: std::process::id() as u64,
                                        process_path: String::new(),
                                        position: crate::active_window::WindowPosition {
                                            x: 0.0,
                                            y: 0.0,
                                            width: 0.0,
                                            height: 0.0,
                                        },
                                    });
                            }
                        }
                        let task = tokio::spawn(async move {
                            let mut final_text = transcription_clone.clone();
                            let mut post_process_prompt_text = String::new();
                            let mut post_process_prompt_name = String::new();
                            let mut post_process_prompt_id: Option<String> = None;
                            let mut used_model: Option<String> = None;
                            let mut error_shown = false;

                            // 1. Try Chinese variant conversion first
                            let mut chinese_converted_text = transcription_clone.clone();
                            if let Some(converted_text) =
                                maybe_convert_chinese_variant(&settings_clone, &transcription_clone)
                                    .await
                            {
                                final_text = converted_text.clone();
                                chinese_converted_text = converted_text;
                                used_model = Some("OpenCC".to_string());
                            }

                            // 2. Apply LLM post-processing if enabled
                            let token_count: Option<i64>;
                            let llm_call_count: Option<i64>;
                            {
                                let secondary = if settings_clone.post_process_use_secondary_output
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

                                // Lookup profile for the active app with title rule matching
                                let (app_profile, matched_rule) = active_window_snapshot_for_review
                                    .as_ref()
                                    .map(|info| {
                                        // Find profile for this app (case-insensitive)
                                        let profile_id = settings_clone
                                            .app_to_profile
                                            .iter()
                                            .find(|(k, _)| k.eq_ignore_ascii_case(&info.app_name))
                                            .map(|(_, v)| v);
                                        let profile = profile_id.and_then(|pid| {
                                            settings_clone
                                                .app_profiles
                                                .iter()
                                                .find(|p| &p.id == pid)
                                        });

                                        if let Some(p) = profile {
                                            // Find all matching rules
                                            let mut matched_rules = Vec::new();

                                            for rule in &p.rules {
                                                let matched = match rule.match_type {
                                                    crate::settings::TitleMatchType::Text => info
                                                        .title
                                                        .to_lowercase()
                                                        .contains(&rule.pattern.to_lowercase()),
                                                    crate::settings::TitleMatchType::Regex => {
                                                        regex::Regex::new(&rule.pattern)
                                                            .map(|re| re.is_match(&info.title))
                                                            .unwrap_or(false)
                                                    }
                                                };
                                                if matched {
                                                    matched_rules.push(rule);
                                                }
                                            }

                                            // Select the best match (longest pattern length wins)
                                            // This allows specific rules (e.g. "Matt M") to override generic ones (e.g. "Slack")
                                            if let Some(best_rule) = matched_rules
                                                .into_iter()
                                                .max_by_key(|r| r.pattern.chars().count())
                                            {
                                                (Some(p), Some(best_rule))
                                            } else {
                                                // No rule matched, use profile defaults
                                                (Some(p), None)
                                            }
                                        } else {
                                            (None, None)
                                        }
                                    })
                                    .unwrap_or((None, None));

                                // Determine policy and prompt_id from matched rule or profile defaults
                                let app_policy = matched_rule
                                    .map(|r| r.policy)
                                    .or_else(|| app_profile.map(|p| p.policy))
                                    .unwrap_or(crate::settings::AppReviewPolicy::Auto);

                                let override_prompt_id = matched_rule
                                    .and_then(|r| r.prompt_id.clone())
                                    .or_else(|| app_profile.and_then(|p| p.prompt_id.clone()));

                                info!(
                                    "[Transcribe] App profile resolution: app_profile={:?}, matched_rule={:?}, override_prompt_id={:?}, app_policy={:?}, global_selected_prompt_id={:?}",
                                    app_profile.map(|p| &p.id),
                                    matched_rule.map(|r| &r.pattern),
                                    override_prompt_id,
                                    app_policy,
                                    settings_clone.post_process_selected_prompt_id,
                                );

                                // ═══════════════════════════════════════════
                                // Unified post-processing pipeline
                                // ═══════════════════════════════════════════
                                let pipeline_result =
                                    crate::actions::post_process::unified_post_process(
                                        &ah_clone,
                                        &settings_clone,
                                        &chinese_converted_text,
                                        secondary.as_deref(),
                                        true,
                                        override_prompt_id.clone(),
                                        active_window_snapshot_for_review
                                            .as_ref()
                                            .map(|info| info.app_name.clone()),
                                        active_window_snapshot_for_review
                                            .as_ref()
                                            .map(|info| info.title.clone()),
                                        matched_rule.map(|r| r.pattern.clone()),
                                        matched_rule.map(|r| r.match_type),
                                        history_id,
                                        skill_mode,
                                        review_editor_active,
                                        selected_text.clone(),
                                        review_document_text.clone(),
                                    )
                                    .await;

                                // Handle pipeline result
                                let mut post_process_failed = false;
                                match pipeline_result {
                                    crate::actions::post_process::PipelineResult::Skipped => {
                                        // No post-processing — use original transcription
                                        token_count = None;
                                        llm_call_count = None;
                                    }

                                    crate::actions::post_process::PipelineResult::Cached {
                                        text,
                                        model,
                                        prompt_id,
                                    } => {
                                        final_text = text;
                                        if model.is_some() {
                                            used_model = model;
                                        }
                                        if prompt_id.is_some() {
                                            post_process_prompt_id = prompt_id;
                                        }
                                        token_count = Some(0);
                                        llm_call_count = Some(0);
                                    }

                                    crate::actions::post_process::PipelineResult::PassThrough {
                                        text,
                                        intent_token_count,
                                    } => {
                                        final_text = text;
                                        token_count = intent_token_count;
                                        llm_call_count = Some(1);
                                    }

                                    crate::actions::post_process::PipelineResult::PendingSkillConfirmation => {
                                        info!("[PostProcess] Skill confirmation pending, keeping overlay visible");
                                        return;
                                    }

                                    crate::actions::post_process::PipelineResult::MultiModelManual {
                                        multi_items,
                                        intent_token_count,
                                        prompt_id: effective_prompt_id,
                                    } => {
                                        // Manual mode: show review window immediately with loading candidates,
                                        // then start multi-model processing (results stream via events).
                                        let output_mode = if let Some(ref pid) = effective_prompt_id {
                                            settings_clone
                                                .post_process_prompts
                                                .iter()
                                                .find(|p| &p.id == pid)
                                                .map(|p| p.output_mode)
                                                .or_else(|| {
                                                    let sm = crate::managers::skill::SkillManager::new(&ah_clone);
                                                    sm.get_all_skills()
                                                        .into_iter()
                                                        .find(|p| &p.id == pid)
                                                        .map(|p| p.output_mode)
                                                })
                                                .unwrap_or_default()
                                        } else {
                                            crate::settings::PromptOutputMode::default()
                                        };

                                        // Build loading candidates (not ready yet)
                                        let loading_candidates: Vec<crate::review_window::MultiModelCandidate> =
                                            multi_items
                                                .iter()
                                                .map(|item| {
                                                    let label = item
                                                        .custom_label
                                                        .clone()
                                                        .unwrap_or_else(|| {
                                                            let provider_label = settings_clone
                                                                .post_process_provider(&item.provider_id)
                                                                .map(|p| p.label.clone())
                                                                .unwrap_or_else(|| item.provider_id.clone());
                                                            format!("{} {}", provider_label, item.model_id)
                                                        });
                                                    crate::review_window::MultiModelCandidate {
                                                        id: item.id.clone(),
                                                        label,
                                                        text: String::new(),
                                                        confidence: None,
                                                        processing_time_ms: 0,
                                                        error: None,
                                                        ready: false,
                                                    }
                                                })
                                                .collect();

                                        // Show review window immediately
                                        crate::review_window::set_last_active_window(
                                            active_window_snapshot_for_review.clone(),
                                        );
                                        crate::review_window::show_review_window_with_candidates(
                                            &ah_clone,
                                            transcription_clone.clone(),
                                            loading_candidates,
                                            history_id,
                                            output_mode,
                                            None,
                                            effective_prompt_id.clone(),
                                        );
                                        utils::hide_recording_overlay(&ah_clone);
                                        change_tray_icon(&ah_clone, TrayIconState::Idle);

                                        // Now start multi-model processing (emits progress events for live UI updates)
                                        info!("[MultiModel] Starting streaming multi-model post-processing ({} models)", multi_items.len());
                                        let results =
                                            crate::actions::post_process::multi_post_process_transcription(
                                                &ah_clone,
                                                &settings_clone,
                                                &chinese_converted_text,
                                                secondary.as_deref(),
                                                history_id,
                                                active_window_snapshot_for_review
                                                    .as_ref()
                                                    .map(|info| info.app_name.clone()),
                                                active_window_snapshot_for_review
                                                    .as_ref()
                                                    .map(|info| info.title.clone()),
                                                override_prompt_id.clone(),
                                            )
                                            .await;

                                        // Save best result to history
                                        let multi_total_tokens: Option<i64> = {
                                            let mut sum: i64 = intent_token_count.unwrap_or(0);
                                            sum += results.iter().filter_map(|r| r.token_count).sum::<i64>();
                                            if sum > 0 { Some(sum) } else { None }
                                        };
                                        let multi_call_count: Option<i64> = {
                                            let mut count = results.len() as i64;
                                            if intent_token_count.is_some() { count += 1; }
                                            if count > 0 { Some(count) } else { None }
                                        };
                                        if let Some(best) = results.iter().find(|r| r.ready && r.error.is_none()) {
                                            let model_name = multi_items
                                                .iter()
                                                .find(|item| item.id == best.id)
                                                .map(|item| item.model_id.clone())
                                                .unwrap_or_else(|| best.label.clone());
                                            if let Some(hid) = history_id {
                                                if let Err(e) = hm_clone
                                                    .save_post_processed_text(
                                                        hid,
                                                        best.text.clone(),
                                                        Some(model_name),
                                                        settings_clone.post_process_selected_prompt_id.clone(),
                                                        multi_total_tokens,
                                                        multi_call_count,
                                                    )
                                                    .await
                                                {
                                                    error!("Failed to save multi-model result to history: {}", e);
                                                }
                                            }
                                        }
                                        return;
                                    }

                                    crate::actions::post_process::PipelineResult::MultiModelAutoPick {
                                        candidates,
                                        multi_items,
                                        total_token_count,
                                        llm_call_count: multi_call_count,
                                        prompt_id: effective_prompt_id,
                                    } => {
                                        token_count = total_token_count;
                                        llm_call_count = multi_call_count;

                                        // Auto-pick: select best result
                                        let best_result = candidates.iter().find(|r| r.ready && r.error.is_none());
                                        if let Some(best) = best_result {
                                            let model_name = multi_items
                                                .iter()
                                                .find(|item| item.id == best.id)
                                                .map(|item| item.model_id.clone())
                                                .unwrap_or_else(|| best.label.clone());

                                            final_text = best.text.clone();
                                            used_model = Some(model_name);
                                            if effective_prompt_id.is_some() {
                                                post_process_prompt_id = effective_prompt_id;
                                            }
                                        } else {
                                            // All candidates failed — use original text
                                            info!("[UnifiedPipeline] All multi-model candidates failed, using original transcription");
                                            error_shown = true;
                                        }
                                    }

                                    crate::actions::post_process::PipelineResult::SingleModel {
                                        text: processed_text,
                                        model,
                                        prompt_id,
                                        token_count: tc,
                                        llm_call_count: lc,
                                        error: err,
                                        error_message,
                                    } => {
                                        token_count = tc;
                                        llm_call_count = lc;
                                        post_process_failed = err && processed_text.is_none();
                                        error_shown = error_shown || err;

                                        if model.is_some() {
                                            used_model = model;
                                        }
                                        if let Some(ref text) = processed_text {
                                            final_text = text.clone();
                                        }
                                        if prompt_id.is_some() {
                                            post_process_prompt_id = prompt_id;
                                        }
                                        if post_process_failed {
                                            if let Some(msg) = error_message {
                                                error!("Post-processing failed: {}", msg);
                                            }
                                        }
                                    }
                                }

                                // Capture the prompt content for history
                                if let Some(pid) = &post_process_prompt_id {
                                    if let Some(prompt) = settings_clone
                                        .post_process_prompts
                                        .iter()
                                        .find(|p| &p.id == pid)
                                    {
                                        post_process_prompt_text = prompt.instructions.clone();
                                        post_process_prompt_name = prompt.name.clone();
                                    }
                                }

                                let change_percent =
                                    compute_change_percent(&transcription_clone, &final_text);

                                let confidence_reason: Option<String> = None;

                                // Get output_mode early to determine review behavior
                                let output_mode = if let Some(pid) = &post_process_prompt_id {
                                    settings_clone
                                        .post_process_prompts
                                        .iter()
                                        .find(|p| &p.id == pid)
                                        .map(|p| p.output_mode)
                                        .unwrap_or_default()
                                } else {
                                    crate::settings::PromptOutputMode::default()
                                };

                                let should_review = if matches!(
                                    votype_mode,
                                    VotypeInputMode::MainPolishInput
                                        | VotypeInputMode::MainSelectedEdit
                                        | VotypeInputMode::ReviewRewrite
                                ) {
                                    false
                                } else
                                // App policy "Always" takes highest priority — show review
                                // regardless of post-processing result or errors.
                                if app_policy == crate::settings::AppReviewPolicy::Always {
                                    true
                                }
                                // App policy "Never" — never show review
                                else if app_policy == crate::settings::AppReviewPolicy::Never {
                                    false
                                }
                                // If post-processing failed completely, skip review
                                else if post_process_failed {
                                    false
                                } else if override_prompt_id.as_deref()
                                    == Some("__SKIP_POST_PROCESS__")
                                {
                                    false
                                }
                                // Skill mode always shows review window (user explicitly invoked a skill)
                                else if skill_mode {
                                    true
                                }
                                // Chat mode always shows review window
                                else if output_mode == crate::settings::PromptOutputMode::Chat {
                                    true
                                } else {
                                    // Auto policy: gate with prompt-level confidence check
                                    let (check_enabled, threshold) =
                                        if let Some(pid) = &post_process_prompt_id {
                                            settings_clone
                                                .post_process_prompts
                                                .iter()
                                                .find(|p| &p.id == pid)
                                                .map(|p| {
                                                    (
                                                        p.confidence_check_enabled,
                                                        p.confidence_threshold.unwrap_or(70),
                                                    )
                                                })
                                                .unwrap_or((false, 70))
                                        } else {
                                            (false, 70)
                                        };

                                    if !check_enabled {
                                        false
                                    } else {
                                        change_percent >= threshold
                                    }
                                };

                                if should_review {
                                    log::info!(
                                        "Review required (policy={:?}, change_percent={}), showing window",
                                        app_policy, change_percent
                                    );

                                    crate::review_window::set_last_active_window(
                                        active_window_snapshot_for_review.clone(),
                                    );
                                    // Persist LLM output so history always captures it
                                    if let Some(history_id) = history_id {
                                        if let Err(e) = hm_clone
                                            .update_transcription_post_processing(
                                                history_id,
                                                final_text.clone(),
                                                post_process_prompt_text.clone(),
                                                post_process_prompt_name.clone(),
                                                post_process_prompt_id.clone(),
                                                used_model.clone(),
                                                token_count,
                                                llm_call_count,
                                            )
                                            .await
                                        {
                                            error!(
                                                "Failed to update transcription with post-processing before review: {}",
                                                e
                                            );
                                        }
                                    }

                                    // Show the review window with the transcription
                                    let skill_name_for_review =
                                        if skill_mode && !post_process_prompt_name.is_empty() {
                                            Some(post_process_prompt_name.clone())
                                        } else {
                                            None
                                        };
                                    crate::review_window::show_review_window(
                                        &ah_clone,
                                        transcription_clone.clone(),
                                        final_text.clone(),
                                        change_percent,
                                        history_id,
                                        confidence_reason.clone(),
                                        output_mode,
                                        skill_name_for_review,
                                        post_process_prompt_id
                                            .clone()
                                            .or(override_prompt_id.clone()),
                                        used_model.clone(),
                                    );
                                    // Hide the overlay since review window is now shown
                                    utils::hide_recording_overlay(&ah_clone);
                                    change_tray_icon(&ah_clone, TrayIconState::Idle);
                                    return;
                                }
                                if post_process_failed {
                                    // Error already logged in PipelineResult::SingleModel arm
                                }
                            }

                            // 3. Save the result to database (Available for both branches)
                            if let Some(history_id) = history_id {
                                if let Err(e) = hm_clone
                                    .update_transcription_post_processing(
                                        history_id,
                                        final_text.clone(),
                                        post_process_prompt_text,
                                        post_process_prompt_name,
                                        post_process_prompt_id,
                                        used_model,
                                        token_count,
                                        llm_call_count,
                                    )
                                    .await
                                {
                                    error!(
                                        "Failed to update transcription with post-processing: {}",
                                        e
                                    );
                                }
                            }

                            if rm_clone.get_current_transcription_id() != current_transcription_id {
                                info!(
                                    "New recording started during post-processing; skipping paste."
                                );
                                return;
                            }

                            if matches!(votype_mode, VotypeInputMode::MainPolishInput) {
                                utils::hide_recording_overlay(&ah_clone);
                                change_tray_icon(&ah_clone, TrayIconState::Idle);
                                let _ = ah_clone.emit("votype-local-insert", final_text.clone());
                                return;
                            }

                            if matches!(votype_mode, VotypeInputMode::MainSelectedEdit) {
                                utils::hide_recording_overlay(&ah_clone);
                                change_tray_icon(&ah_clone, TrayIconState::Idle);
                                let _ = ah_clone.emit("votype-local-insert", final_text.clone());
                                return;
                            }

                            if matches!(votype_mode, VotypeInputMode::ReviewRewrite) {
                                utils::hide_recording_overlay(&ah_clone);
                                change_tray_icon(&ah_clone, TrayIconState::Idle);
                                let _ = ah_clone
                                    .emit("review-window-rewrite-apply", final_text.clone());
                                return;
                            }

                            let ah_clone_inner = ah_clone.clone();
                            ah_clone
                                .run_on_main_thread(move || {
                                    // If no error needs to be shown, hide immediately.
                                    if !error_shown {
                                        utils::hide_recording_overlay(&ah_clone_inner);
                                        change_tray_icon(&ah_clone_inner, TrayIconState::Idle);
                                    } else {
                                        let ah_delayed = ah_clone_inner.clone();
                                        std::thread::spawn(move || {
                                            std::thread::sleep(Duration::from_millis(3000));
                                            utils::hide_recording_overlay(&ah_delayed);
                                            change_tray_icon(&ah_delayed, TrayIconState::Idle);
                                        });
                                    }

                                    if let Err(e) = utils::paste(final_text, ah_clone_inner) {
                                        error!("Failed to paste transcription: {}", e);
                                    }
                                })
                                .unwrap_or_else(|e| {
                                    error!("Failed to run paste on main thread: {:?}", e)
                                });
                        });

                        ppm.set_current_task(task.abort_handle());
                        // Await the inner task so the FinishGuard stays
                        // alive (keeping Esc registered) during post-processing.
                        let _ = task.await;
                    } else {
                        // Post-processing is disabled — check if app policy still
                        // requires showing the review window before pasting.
                        let votype_mode = if shortcut_str == "review-window-local" {
                            VotypeInputMode::ReviewRewrite
                        } else {
                            crate::window_context::resolve_votype_input_mode(
                                active_window_snapshot
                                    .as_ref()
                                    .map(|info| info.app_name.as_str()),
                                active_window_snapshot
                                    .as_ref()
                                    .map(|info| info.title.as_str()),
                                review_editor_active,
                                selected_text
                                    .as_ref()
                                    .map(|text| !text.trim().is_empty())
                                    .unwrap_or(false),
                            )
                        };
                        let (app_policy, resolved_prompt_id) = active_window_snapshot
                            .as_ref()
                            .and_then(|info| {
                                let profile_id = settings
                                    .app_to_profile
                                    .iter()
                                    .find(|(k, _)| k.eq_ignore_ascii_case(&info.app_name))
                                    .map(|(_, v)| v);
                                let profile = profile_id.and_then(|pid| {
                                    settings.app_profiles.iter().find(|p| &p.id == pid)
                                });
                                profile.map(|p| {
                                    // Check title rules for a more specific policy
                                    let matched_rule = p
                                        .rules
                                        .iter()
                                        .filter(|r| match r.match_type {
                                            crate::settings::TitleMatchType::Text => info
                                                .title
                                                .to_lowercase()
                                                .contains(&r.pattern.to_lowercase()),
                                            crate::settings::TitleMatchType::Regex => {
                                                regex::Regex::new(&r.pattern)
                                                    .map(|re| re.is_match(&info.title))
                                                    .unwrap_or(false)
                                            }
                                        })
                                        .max_by_key(|r| r.pattern.chars().count());
                                    let policy = matched_rule.map(|r| r.policy).unwrap_or(p.policy);
                                    let prompt_id = matched_rule
                                        .and_then(|r| r.prompt_id.clone())
                                        .or_else(|| p.prompt_id.clone());
                                    (policy, prompt_id)
                                })
                            })
                            .unwrap_or((crate::settings::AppReviewPolicy::Auto, None));

                        if matches!(votype_mode, VotypeInputMode::MainPolishInput) {
                            let ah_clone = ah.clone();
                            ah.run_on_main_thread(move || {
                                utils::hide_recording_overlay(&ah_clone);
                                change_tray_icon(&ah_clone, TrayIconState::Idle);
                                let _ = ah_clone.emit("votype-local-insert", transcription_clone);
                            })
                            .unwrap_or_else(|e| {
                                error!("Failed to emit local insert on main thread: {:?}", e)
                            });
                        } else if matches!(votype_mode, VotypeInputMode::MainSelectedEdit) {
                            let ah_clone = ah.clone();
                            ah.run_on_main_thread(move || {
                                utils::hide_recording_overlay(&ah_clone);
                                change_tray_icon(&ah_clone, TrayIconState::Idle);
                                log::warn!(
                                    "Selected-edit mode requires post-processing; skipping raw insertion"
                                );
                            })
                            .unwrap_or_else(|e| {
                                error!("Failed to finish selected-edit fallback on main thread: {:?}", e)
                            });
                        } else if matches!(votype_mode, VotypeInputMode::ReviewRewrite) {
                            let ah_clone = ah.clone();
                            ah.run_on_main_thread(move || {
                                utils::hide_recording_overlay(&ah_clone);
                                change_tray_icon(&ah_clone, TrayIconState::Idle);
                                log::warn!(
                                    "Review rewrite mode requires post-processing; skipping raw document replacement"
                                );
                            })
                            .unwrap_or_else(|e| {
                                error!("Failed to finish review rewrite fallback on main thread: {:?}", e)
                            });
                        } else if app_policy == crate::settings::AppReviewPolicy::Always {
                            // Resolve output_mode from the prompt configured for this app,
                            // falling back to the global selected prompt.
                            let effective_prompt_id = resolved_prompt_id
                                .or_else(|| settings.post_process_selected_prompt_id.clone());
                            let output_mode = effective_prompt_id
                                .as_ref()
                                .and_then(|pid| {
                                    settings
                                        .post_process_prompts
                                        .iter()
                                        .find(|p| &p.id == pid)
                                        .map(|p| p.output_mode)
                                })
                                .unwrap_or(crate::settings::SkillOutputMode::Polish);

                            info!(
                                "[Transcribe] App policy is Always (no post-processing), showing review window (output_mode={:?})",
                                output_mode
                            );
                            crate::review_window::set_last_active_window(
                                active_window_snapshot.clone(),
                            );
                            let ah_clone = ah.clone();
                            crate::review_window::show_review_window(
                                &ah_clone,
                                transcription_clone.clone(),
                                transcription_clone.clone(),
                                0,
                                history_id,
                                None,
                                output_mode,
                                None,
                                effective_prompt_id,
                                None,
                            );
                            utils::hide_recording_overlay(&ah_clone);
                            change_tray_icon(&ah_clone, TrayIconState::Idle);
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
                    }
                } else {
                    let err_msg = primary_error.unwrap_or_else(|| "unknown".to_string());
                    debug!("Global Shortcut Transcription error: {}", err_msg);

                    // Update the pre-saved placeholder with the failure message.
                    // Audio was already saved during pre-save so users can retry later.
                    let asr_model = if settings.online_asr_enabled {
                        settings
                            .selected_asr_model_id
                            .clone()
                            .unwrap_or_else(|| "online".to_string())
                    } else {
                        settings.selected_model.clone()
                    };

                    let failure_text = format!("[Transcription failed] {}", err_msg);
                    if let Some(pid) = presave_history_id {
                        if let Err(e) = hm
                            .update_transcription_content(
                                pid,
                                failure_text,
                                asr_model,
                                settings.selected_language.clone(),
                                duration_ms,
                                transcription_ms,
                                0,
                            )
                            .await
                        {
                            error!("Failed to update failed transcription in history: {}", e);
                        }
                    }

                    let _ = ah.emit(
                        "overlay-error",
                        serde_json::json!({
                            "code": "transcription_failed_saved",
                        }),
                    );

                    // Give the user a moment to see the failure state, then close the overlay.
                    sleep(Duration::from_millis(2500)).await;
                }
            } else {
                debug!("No samples retrieved from recording stop");
            }
        });

        ppm_outer.set_pipeline_task(pipeline_handle);

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }

    fn mode(&self) -> super::ActionMode {
        super::ActionMode::Stateful
    }
}

fn realtime_worker_loop(
    rx: std::sync::mpsc::Receiver<Vec<f32>>,
    tm: &TranscriptionManager,
    app: &AppHandle,
    interval_ms: u64,
    window_seconds: u64,
) {
    let sample_rate = 16000;
    let max_window_samples = (window_seconds as usize) * sample_rate;
    let mut accumulated: Vec<f32> = Vec::new();
    let mut last_transcribe = Instant::now();
    let mut has_new_audio = false;
    // Segment-based: keep finalized text from previous segments, only re-transcribe current window
    let mut finalized_text = String::new();
    let mut finalized_samples: usize = 0;

    // Punctuation anchoring: run punct model every cycle, anchors as fallback when busy
    let mut punct_anchors: Vec<PunctAnchor> = Vec::new();
    // Track the last raw text so we can apply final punctuation on exit
    let mut last_raw_text = String::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(interval_ms)) {
            Ok(frame) => {
                accumulated.extend_from_slice(&frame);
                has_new_audio = true;

                // Check if it's time to transcribe
                if last_transcribe.elapsed().as_millis() < interval_ms as u128 {
                    continue;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // No new speech frames — skip if no new audio since last transcription
                if !has_new_audio || accumulated.is_empty() {
                    continue;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                // Recording ended — do one final punct pass on the full text
                if !last_raw_text.is_empty() {
                    if let Some(final_punctuated) = tm.try_add_punctuation(&last_raw_text) {
                        debug!("Realtime worker: final punct pass before exit");
                        let _ = app.emit(
                            "realtime-partial",
                            serde_json::json!({ "text": final_punctuated }),
                        );
                    }
                }
                debug!("Realtime worker: channel disconnected, exiting");
                break;
            }
        }

        if accumulated.is_empty() {
            continue;
        }

        // Only transcribe the current (un-finalized) window
        let current_audio = &accumulated[finalized_samples..];
        // Need at least ~1.5s of audio for meaningful transcription;
        // shorter clips produce garbage results.
        if current_audio.len() < sample_rate * 3 / 2 {
            continue;
        }

        let st = Instant::now();
        if let Some(current_text) = tm.try_transcribe_raw(current_audio.to_vec()) {
            let elapsed_ms = st.elapsed().as_millis();

            // Filter out non-displayable characters (rare model tokens that render
            // as replacement chars or control chars in UI/terminal).
            let clean_text: String = current_text
                .chars()
                .filter(|c| {
                    !c.is_control() && *c != '\u{FFFD}' && !('\u{E000}'..='\u{F8FF}').contains(c)
                    // Private Use Area
                })
                .collect();
            if clean_text.is_empty() {
                continue;
            }

            // Combine finalized segments with current window
            let raw_text = if finalized_text.is_empty() {
                clean_text.clone()
            } else {
                format!("{}{}", finalized_text, clean_text)
            };
            last_raw_text.clone_from(&raw_text);

            // Punctuation: run every cycle so display always has punctuation.
            // Anchors are fallback only when punct model is busy.
            let display_text = if let Some(punctuated) = tm.try_add_punctuation(&raw_text) {
                punct_anchors = extract_punct_anchors(&raw_text, &punctuated);
                punctuated
            } else {
                apply_punct_anchors(&raw_text, &punct_anchors)
            };

            if crate::DEBUG_LOG_TRANSCRIPTION.load(std::sync::atomic::Ordering::Relaxed) {
                let preview: String = display_text.chars().take(80).collect();
                let suffix = if display_text.chars().count() > 80 {
                    "…"
                } else {
                    ""
                };
                info!(
                    "Realtime partial ({}ms, {}s audio, len={}): {}{}",
                    elapsed_ms,
                    current_audio.len() / sample_rate,
                    display_text.chars().count(),
                    preview,
                    suffix,
                );
            }
            let _ = app.emit(
                "realtime-partial",
                serde_json::json!({ "text": display_text }),
            );
            last_transcribe = Instant::now();
            has_new_audio = false;

            // If current window exceeds max, finalize it and start fresh
            if current_audio.len() > max_window_samples {
                finalized_text = raw_text;
                finalized_samples = accumulated.len();
                debug!(
                    "Realtime: finalized segment, total finalized text len={}",
                    finalized_text.len()
                );
            }
        }
        // If engine is busy, skip this round — try again next interval
    }
}

// ─── Punctuation anchoring ──────────────────────────────────────────────────

/// A punctuation mark with its surrounding character context, used to
/// re-insert punctuation into new ASR output between punct-model runs.
struct PunctAnchor {
    /// Up to 2 characters immediately before the punctuation mark.
    before: String,
    /// Up to 1 character immediately after (empty if punct is at end of text).
    after: String,
    /// The punctuation character itself.
    punct: char,
}

/// Characters the CT-Transformer punct model may insert.
fn is_inserted_punct(c: char) -> bool {
    matches!(
        c,
        '，' | '。'
            | '！'
            | '？'
            | '；'
            | '：'
            | '、'
            | '\u{201C}' // "
            | '\u{201D}' // "
            | '\u{2018}' // '
            | '\u{2019}' // '
            | '（'
            | '）'
            | '《'
            | '》'
            | '【'
            | '】'
            | '…'
            | '—'
            | ','
            | '.'
            | '!'
            | '?'
            | ';'
            | ':'
    )
}

/// Compare raw text with its punctuated version and extract anchors
/// that record where each punctuation mark was inserted.
fn extract_punct_anchors(raw: &str, punctuated: &str) -> Vec<PunctAnchor> {
    let raw_chars: Vec<char> = raw.chars().collect();
    let punct_chars: Vec<char> = punctuated.chars().collect();
    let mut anchors = Vec::new();
    let mut ri = 0; // index into raw_chars
    let mut pi = 0; // index into punct_chars

    while pi < punct_chars.len() {
        if ri < raw_chars.len() && punct_chars[pi] == raw_chars[ri] {
            // Characters match — advance both
            ri += 1;
            pi += 1;
        } else if is_inserted_punct(punct_chars[pi]) {
            // Inserted punctuation — record surrounding context from raw text
            let before: String = raw_chars[..ri]
                .iter()
                .rev()
                .take(2)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .cloned()
                .collect();
            let after: String = raw_chars[ri..].iter().take(1).cloned().collect();

            if !before.is_empty() {
                anchors.push(PunctAnchor {
                    before,
                    after,
                    punct: punct_chars[pi],
                });
            }
            pi += 1;
        } else {
            // Non-punct mismatch — alignment is broken, stop
            break;
        }
    }

    anchors
}

/// Apply saved punctuation anchors to new raw text by matching the
/// surrounding character patterns and inserting punct marks.
fn apply_punct_anchors(raw: &str, anchors: &[PunctAnchor]) -> String {
    if anchors.is_empty() {
        return raw.to_string();
    }

    // Collect insertion points: (byte_position, punct_char)
    let mut insertions: Vec<(usize, char)> = Vec::new();
    let mut search_from: usize = 0;

    for anchor in anchors {
        if anchor.after.is_empty() {
            // Punct was at the end of text — only insert if text still ends with `before`
            if raw.ends_with(&anchor.before) {
                insertions.push((raw.len(), anchor.punct));
            }
        } else {
            let pattern = format!("{}{}", anchor.before, anchor.after);
            if let Some(rel_pos) = raw[search_from..].find(&pattern) {
                let abs_pos = search_from + rel_pos;
                let insert_pos = abs_pos + anchor.before.len();
                insertions.push((insert_pos, anchor.punct));
                search_from = insert_pos;
            }
        }
    }

    if insertions.is_empty() {
        return raw.to_string();
    }

    // Insert from right to left so earlier byte positions stay valid
    insertions.sort_by(|a, b| b.0.cmp(&a.0));

    let mut result = raw.to_string();
    for (pos, punct) in insertions {
        if pos <= result.len() {
            result.insert(pos, punct);
        }
    }

    result
}
