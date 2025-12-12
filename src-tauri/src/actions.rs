use crate::active_window;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::overlay::{
    show_llm_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::settings::{get_settings, AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;
use tauri::Manager;

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction;

async fn maybe_post_process_transcription(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    debug!("=== POST-PROCESSING DEBUG START ===");
    debug!("Post-processing enabled: {}", settings.post_process_enabled);
    debug!("Input transcription length: {} chars", transcription.len());
    // Safe character boundary slicing for preview
    let transcription_preview_end = transcription
        .char_indices()
        .nth(50)
        .map(|(i, _)| i)
        .unwrap_or(transcription.len());
    debug!(
        "Input transcription preview: '{}...'",
        &transcription[..transcription_preview_end]
    );

    if !settings.post_process_enabled {
        debug!("Post-processing DISABLED - returning early");
        return None;
    }

    debug!(
        "Active provider ID: {:?}",
        settings.post_process_provider_id
    );
    debug!(
        "Available providers: {:?}",
        settings
            .post_process_providers
            .iter()
            .map(|p| &p.id)
            .collect::<Vec<_>>()
    );

    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => {
            debug!("Selected provider: {} ({})", provider.label, provider.id);
            provider
        }
        None => {
            info!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => {
            debug!("Selected prompt ID: {}", id);
            id.clone()
        }
        None => {
            info!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    debug!(
        "Available prompts: {:?}",
        settings
            .post_process_prompts
            .iter()
            .map(|p| (&p.id, &p.name))
            .collect::<Vec<_>>()
    );

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => {
            debug!("Found prompt: '{}' (ID: {})", prompt.name, prompt.id);
            // Safe character boundary slicing for preview
            let preview_end = prompt
                .prompt
                .char_indices()
                .nth(100)
                .map(|(i, _)| i)
                .unwrap_or(prompt.prompt.len());
            debug!(
                "Prompt content preview: '{}...'",
                &prompt.prompt[..preview_end]
            );
            prompt
        }
        None => {
            info!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.prompt.trim().is_empty() {
        info!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!("All configured models: {:?}", settings.post_process_models);
    debug!(
        "Selected prompt model ID (from prompt): {:?}",
        prompt.model_id
    );
    debug!(
        "Selected prompt model ID (global fallback): {:?}",
        settings.selected_prompt_model_id
    );
    debug!(
        "Cached models: {:?}",
        settings
            .cached_models
            .iter()
            .map(|m| (&m.id, &m.model_id, &m.provider_id))
            .collect::<Vec<_>>()
    );

    // Use model_id from the prompt, falling back to global selection
    let target_model_cache_id = prompt.model_id.as_ref().or(settings.selected_prompt_model_id.as_ref());

    let model = if let Some(selected_model_id) = target_model_cache_id {
        settings
            .cached_models
            .iter()
            .find(|m| m.id == *selected_model_id && m.provider_id == provider.id)
            .map(|m| m.model_id.clone())
    } else {
        None
    }
    .or_else(|| {
        // Fallback to post_process_models if no cached model selected
        settings.post_process_models.get(&provider.id).cloned()
    })
    .unwrap_or_default();

    debug!("Model for provider '{}': '{}'", provider.id, model);

    if model.trim().is_empty() {
        info!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    debug!("Provider base URL: {}", provider.base_url);

    info!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    show_llm_processing_overlay(app_handle);

    // Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());
    // Safe character boundary slicing for preview
    let processed_prompt_preview_end = processed_prompt
        .char_indices()
        .nth(200)
        .map(|(i, _)| i)
        .unwrap_or(processed_prompt.len());
    debug!(
        "Processed prompt preview: '{}...'",
        &processed_prompt[..processed_prompt_preview_end]
    );

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                debug!("Apple Intelligence selected but not currently available on this device");
                return None;
            }

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(&processed_prompt, token_limit) {
                Ok(result) => {
                    if result.trim().is_empty() {
                        debug!("Apple Intelligence returned an empty response");
                        None
                    } else {
                        debug!(
                            "Apple Intelligence post-processing succeeded. Output length: {} chars",
                            result.len()
                        );
                        Some(result)
                    }
                }
                Err(err) => {
                    error!("Apple Intelligence post-processing failed: {}", err);
                    None
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            debug!("Apple Intelligence provider selected on unsupported platform");
            return None;
        }
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    debug!(
        "API key configured for provider '{}': {}",
        provider.id,
        !api_key.trim().is_empty()
    );

    // Create OpenAI-compatible client
    debug!("Creating LLM client for provider: {}", provider.id);
    let client = match crate::llm_client::create_client(&provider, api_key) {
        Ok(client) => {
            debug!("LLM client created successfully");
            client
        }
        Err(e) => {
            error!("Failed to create LLM client: {}", e);
            return None;
        }
    };

    // Build the chat completion request
    debug!("Building chat completion request with model: {}", model);
    let message = match ChatCompletionRequestUserMessageArgs::default()
        .content(processed_prompt)
        .build()
    {
        Ok(msg) => ChatCompletionRequestMessage::User(msg),
        Err(e) => {
            error!("Failed to build chat message: {}", e);
            return None;
        }
    };

    let request = match CreateChatCompletionRequestArgs::default()
        .model(&model)
        .messages(vec![message])
        .build()
    {
        Ok(req) => req,
        Err(e) => {
            error!("Failed to build chat completion request: {}", e);
            return None;
        }
    };

    // Send the request
    info!("Sending chat completion request to LLM...");
    match client.chat().create(request).await {
        Ok(response) => {
            debug!("LLM response received successfully");
            debug!("Response choices count: {}", response.choices.len());
            if let Some(choice) = response.choices.first() {
                debug!("Choice found, checking content...");
                if let Some(content) = &choice.message.content {
                    let processed_content = remove_think_tags(content);
                    info!(
                        "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                        provider.id,
                        processed_content.len()
                    );
                    // Safe character boundary slicing for preview
                    let content_preview_end = processed_content
                        .char_indices()
                        .nth(100)
                        .map(|(i, _)| i)
                        .unwrap_or(processed_content.len());
                    debug!("Output preview: '{}...'", &processed_content[..content_preview_end]);
                    debug!("=== POST-PROCESSING DEBUG END ===");
                    Some(processed_content)
                } else {
                    info!("LLM returned empty content for provider '{}'", provider.id);
                    debug!("=== POST-PROCESSING DEBUG END ===");
                    None
                }
            } else {
                info!("LLM returned no choices for provider '{}'", provider.id);
                debug!("=== POST-PROCESSING DEBUG END ===");
                None
            }
        }
        Err(e) => {
            // Check if this is a deserialization error due to missing OpenAI standard fields
            let error_str = e.to_string();
            if (error_str.contains("missing field") || error_str.contains("unknown variant"))
                && provider.id.starts_with("custom")
            {
                if let Some(content) = parse_custom_provider_error(&error_str) {
                    return Some(content);
                }
            }

            error!(
                "LLM post-processing failed for provider '{}': {}",
                provider.id, e
            );
            debug!("=== POST-PROCESSING DEBUG END ===");
            None
        }
    }
}

fn remove_think_tags(content: &str) -> String {
    let mut processed_content = content.to_string();
    
    // Remove <think>...</think> sections if present
    while let Some(think_start) = processed_content.find("<think>") {
        if let Some(think_end) = processed_content[think_start..].find("</think>") {
            processed_content.replace_range(think_start..think_start + think_end + 8, "");
        } else {
            break;
        }
    }
    
    // Also handle escaped versions of the tags (often found in raw JSON or specific model outputs)
    while let Some(think_start) = processed_content.find("\\u003cthink\\u003e") {
        if let Some(think_end) = processed_content[think_start..].find("\\u003c/think\\u003e") {
            processed_content.replace_range(think_start..think_start + think_end + 20, "");
        } else {
            break;
        }
    }

    processed_content.trim().to_string()
}

fn clean_response_content(content: &str) -> String {
    let mut processed_content = content.to_string();

    // Handle escaped characters (for raw JSON strings)
    processed_content = processed_content.replace("\\\"", "\"");
    processed_content = processed_content.replace("\\n", "\n");
    processed_content = processed_content.replace("\\\\", "\\");

    remove_think_tags(&processed_content)
}

fn parse_custom_provider_error(error_str: &str) -> Option<String> {
    info!("Detected custom provider response format issue, attempting manual parsing...");

    // First, try to extract the full JSON content from the error message
    if let Some(json_start) = error_str.find("content:{") {
        if let Some(json_end) = error_str[json_start..].find("}") {
            let json_content = &error_str[json_start..json_start + json_end + 1];
            debug!("Found JSON content in error: {}", json_content);

            // Parse the content field from this JSON snippet
            if let Some(content_field_start) = json_content.find("\"content\":\"") {
                if let Some(content_field_end) =
                    json_content[content_field_start + 11..].find("\"")
                {
                    let raw_content = &json_content[content_field_start + 11
                        ..content_field_start + 11 + content_field_end];
                    debug!("Raw content extracted: {}", raw_content);

                    let processed_content = clean_response_content(raw_content);

                    if !processed_content.is_empty() {
                        info!("Successfully extracted and processed content from custom provider response");
                        debug!(
                            "Final content length: {} chars",
                            processed_content.len()
                        );
                        // Safe character boundary slicing for preview
                        let final_preview_end = processed_content
                            .char_indices()
                            .nth(100)
                            .map(|(i, _)| i)
                            .unwrap_or(processed_content.len());
                        debug!(
                            "Final content preview: '{}...'",
                            &processed_content[..final_preview_end]
                        );
                        debug!("=== POST-PROCESSING DEBUG END ===");
                        return Some(processed_content);
                    }
                }
            }
        }
    }

    // Fallback: Try to extract the response content directly from the error
    if let Some(content_start) = error_str.find("\"content\":\"") {
        if let Some(content_end) = error_str[content_start + 11..].find("\",\"role\"") {
            let content =
                &error_str[content_start + 11..content_start + 11 + content_end];
            info!("Successfully extracted content from custom provider response");
            debug!("Extracted content length: {} chars", content.len());
            
            let processed_content = clean_response_content(content);
            
            // Safe character boundary slicing for preview
            let extracted_preview_end = processed_content
                .char_indices()
                .nth(100)
                .map(|(i, _)| i)
                .unwrap_or(processed_content.len());
            debug!(
                "Extracted content preview: '{}...'",
                &processed_content[..extracted_preview_end]
            );
            debug!("=== POST-PROCESSING DEBUG END ===");
            return Some(processed_content);
        }
    }

    // Also check for service_tier specific errors and try to extract content differently
    if error_str.contains("service_tier") && error_str.contains("on_demand") {
        info!("Detected service_tier 'on_demand' variant issue, attempting alternative parsing...");

        // Look for content in a different pattern for service_tier errors
        if let Some(content_start) = error_str.find("\\\"content\\\":\\\"") {
            if let Some(content_end) = error_str[content_start + 12..].find("\\\"") {
                let content =
                    &error_str[content_start + 12..content_start + 12 + content_end];
                
                let processed_content = clean_response_content(content);
                
                info!(
                    "Successfully extracted content from service_tier error response"
                );
                debug!(
                    "Extracted content length: {} chars",
                    processed_content.len()
                );
                // Safe character boundary slicing for preview
                let unescaped_preview_end = processed_content
                    .char_indices()
                    .nth(100)
                    .map(|(i, _)| i)
                    .unwrap_or(processed_content.len());
                debug!(
                    "Extracted content preview: '{}...'",
                    &processed_content[..unescaped_preview_end]
                );
                debug!("=== POST-PROCESSING DEBUG END ===");
                return Some(processed_content);
            }
        }
    }

    None
}

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        // Cancel any running post-processing task
        let ppm = app.state::<Arc<crate::managers::post_processing::PostProcessingManager>>();
        ppm.cancel_current_task();

        // 在线 ASR 模式下不要预加载本地模型
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
        
        // Increment transcription ID to invalidate any pending previous transcriptions
        let new_id = rm.increment_transcription_id();
        debug!("Starting new transcription session with ID: {}", new_id);

        // Get the microphone mode to determine audio feedback timing
        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_started = false;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            recording_started = rm.try_start_recording(&binding_id);
            debug!("Recording started: {}", recording_started);
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            if rm.try_start_recording(&binding_id) {
                recording_started = true;
                debug!("Recording started in {:?}", recording_start_time.elapsed());
                // Small delay to ensure microphone stream is active
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    debug!("Handling delayed audio feedback/mute sequence");
                    // Helper handles disabled audio feedback by returning early, so we reuse it
                    // to keep mute sequencing consistent in every mode.
                    play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    rm_clone.apply_mute();
                });
            } else {
                debug!("Failed to start recording");
            }
        }

        if recording_started {
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());
        let ppm = Arc::clone(&app.state::<Arc<crate::managers::post_processing::PostProcessingManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        // Capture the current transcription ID associated with this recording session
        let current_transcription_id = rm.get_current_transcription_id();
        let binding_id = binding_id.to_string(); // Clone binding_id for the async task

        tauri::async_runtime::spawn(async move {
            let binding_id = binding_id.clone(); // Clone for the inner async task
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
                let samples_clone = samples.clone(); // Clone for history saving
                match tm.transcribe(samples_clone) {
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
                            let hm_clone = Arc::clone(&hm);
                            let samples_clone = samples.clone();

                            // Save history immediately (original)
                            // Calculate duration (assuming 16kHz)
                            let duration_ms = (samples_clone.len() as f64 / 16000.0 * 1000.0) as i64;

                            let history_id = match hm_clone
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

                            // Check if a new recording has started since we began
                            if rm.get_current_transcription_id() != current_transcription_id {
                                info!("New recording started during transcription (ID mismatch: {} != {}). Skipping paste/post-processing.", rm.get_current_transcription_id(), current_transcription_id);
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                                return;
                            }

                            if settings.post_process_enabled {
                                let ah_clone = ah.clone();
                                let settings_clone = settings.clone();
                                let hm_clone = Arc::clone(&hm);
                                let ppm_clone = Arc::clone(&ppm);
                                let rm_clone = Arc::clone(&rm);

                                // Spawn cancellable task
                                let task = tokio::spawn(async move {
                                    let mut final_text = transcription_clone.clone();
                                    let mut post_process_prompt = String::new();

                                    // First, check if Chinese variant conversion is needed
                                    if let Some(converted_text) =
                                        maybe_convert_chinese_variant(&settings_clone, &transcription_clone).await
                                    {
                                        final_text = converted_text;
                                    }
                                    // Then apply regular LLM post-processing if enabled
                                    else if let Some(processed_text) = maybe_post_process_transcription(
                                        &ah_clone,
                                        &settings_clone,
                                        &transcription_clone,
                                    )
                                    .await
                                    {
                                        final_text = processed_text;
                                        
                                        // Get the prompt that was used
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

                                    // Update history if we have processed text
                                    if final_text != transcription_clone {
                                        if let Some(id) = history_id {
                                            if let Err(e) = hm_clone
                                                .update_transcription_post_processing(
                                                    id,
                                                    final_text.clone(),
                                                    post_process_prompt,
                                                )
                                                .await
                                            {
                                                error!("Failed to update history: {}", e);
                                            }
                                        }
                                    }

                                    // Check ID again before pasting after post-processing
                                    if rm_clone.get_current_transcription_id() != current_transcription_id {
                                        info!("New recording started during post-processing (ID mismatch). Skipping paste.");
                                        let ah_clone_inner = ah_clone.clone();
                                        ah_clone.run_on_main_thread(move || {
                                            utils::hide_recording_overlay(&ah_clone_inner);
                                            change_tray_icon(&ah_clone_inner, TrayIconState::Idle);
                                        }).unwrap_or_default();
                                        return;
                                    }

                                    // Paste the final text (either converted, processed, or original)
                                    let ah_clone_inner = ah_clone.clone();
                                    ah_clone
                                        .run_on_main_thread(move || {
                                            utils::hide_recording_overlay(&ah_clone_inner);
                                            change_tray_icon(
                                                &ah_clone_inner,
                                                TrayIconState::Idle,
                                            );
                                            if let Err(e) =
                                                utils::paste(final_text, ah_clone_inner)
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
                                // Post-processing disabled, paste original
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

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
