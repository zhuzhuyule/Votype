use crate::audio_feedback::{play_feedback_sound, SoundType};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::overlay::{show_recording_overlay, show_transcribing_overlay};
use crate::settings::{get_settings, AppSettings};
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
};
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
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    info!("=== POST-PROCESSING DEBUG START ===");
    info!("Post-processing enabled: {}", settings.post_process_enabled);
    info!("Input transcription length: {} chars", transcription.len());
    info!("Input transcription preview: '{}...'", &transcription[..transcription.len().min(50)]);
    
    if !settings.post_process_enabled {
        info!("Post-processing DISABLED - returning early");
        return None;
    }

    info!("Active provider ID: {:?}", settings.post_process_provider_id);
    info!("Available providers: {:?}", settings.post_process_providers.iter().map(|p| &p.id).collect::<Vec<_>>());
    
    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => {
            info!("Selected provider: {} ({})", provider.label, provider.id);
            provider
        },
        None => {
            info!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    info!("All configured models: {:?}", settings.post_process_models);
    info!("Selected prompt model ID: {:?}", settings.selected_prompt_model_id);
    info!("Cached models: {:?}", settings.cached_models.iter().map(|m| (&m.id, &m.model_id, &m.provider_id)).collect::<Vec<_>>());
    
    // Use selected_prompt_model_id from cache instead of post_process_models
    let model = if let Some(selected_model_id) = &settings.selected_prompt_model_id {
        settings.cached_models
            .iter()
            .find(|m| m.id == *selected_model_id && m.provider_id == provider.id)
            .map(|m| m.model_id.clone())
    } else {
        None
    }.or_else(|| {
        // Fallback to post_process_models if no cached model selected
        settings.post_process_models.get(&provider.id).cloned()
    }).unwrap_or_default();

    info!("Model for provider '{}': '{}'", provider.id, model);
    
    if model.trim().is_empty() {
        info!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => {
            info!("Selected prompt ID: {}", id);
            id.clone()
        },
        None => {
            info!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    info!("Available prompts: {:?}", settings.post_process_prompts.iter().map(|p| (&p.id, &p.name)).collect::<Vec<_>>());
    
    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => {
            info!("Found prompt: '{}' (ID: {})", prompt.name, prompt.id);
            info!("Prompt content preview: '{}...'", &prompt.prompt[..prompt.prompt.len().min(100)]);
            prompt.prompt.clone()
        },
        None => {
            info!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        info!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    info!("API key configured for provider '{}': {}", provider.id, !api_key.trim().is_empty());
    info!("Provider base URL: {}", provider.base_url);
    
    info!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    // Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    info!("Processed prompt length: {} chars", processed_prompt.len());
    info!("Processed prompt preview: '{}...'", &processed_prompt[..processed_prompt.len().min(200)]);

    // Create OpenAI-compatible client
    info!("Creating LLM client for provider: {}", provider.id);
    let client = match crate::llm_client::create_client(&provider, api_key) {
        Ok(client) => {
            info!("LLM client created successfully");
            client
        },
        Err(e) => {
            error!("Failed to create LLM client: {}", e);
            return None;
        }
    };

    // Build the chat completion request
    info!("Building chat completion request with model: {}", model);
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
            info!("LLM response received successfully");
            info!("Response choices count: {}", response.choices.len());
            if let Some(choice) = response.choices.first() {
                info!("Choice found, checking content...");
                if let Some(content) = &choice.message.content {
                    info!(
                        "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                        provider.id,
                        content.len()
                    );
                    info!("Output preview: '{}...'", &content[..content.len().min(100)]);
                    info!("=== POST-PROCESSING DEBUG END ===");
                    Some(content.clone())
                } else {
                    info!("LLM returned empty content for provider '{}'", provider.id);
                    info!("=== POST-PROCESSING DEBUG END ===");
                    None
                }
            } else {
                info!("LLM returned no choices for provider '{}'", provider.id);
                info!("=== POST-PROCESSING DEBUG END ===");
                None
            }
        }
        Err(e) => {
            // Check if this is a deserialization error due to missing OpenAI standard fields
            let error_str = e.to_string();
            if (error_str.contains("missing field") || error_str.contains("unknown variant")) && provider.id.starts_with("custom") {
                info!("Detected custom provider response format issue, attempting manual parsing...");
                
                // First, try to extract the full JSON content from the error message
                if let Some(json_start) = error_str.find("content:{") {
                    if let Some(json_end) = error_str[json_start..].find("}") {
                        let json_content = &error_str[json_start..json_start + json_end + 1];
                        info!("Found JSON content in error: {}", json_content);
                        
                        // Parse the content field from this JSON snippet
                        if let Some(content_field_start) = json_content.find("\"content\":\"") {
                            if let Some(content_field_end) = json_content[content_field_start + 11..].find("\"") {
                                let raw_content = &json_content[content_field_start + 11..content_field_start + 11 + content_field_end];
                                info!("Raw content extracted: {}", raw_content);
                                
                                // Process the content to handle escaped characters and ...</think> tags
                                let mut processed_content = raw_content.to_string();
                                
                                // Handle escaped characters
                                processed_content = processed_content.replace("\\\"", "\"");
                                processed_content = processed_content.replace("\\n", "\n");
                                processed_content = processed_content.replace("\\\\", "\\");
                                
                                // Remove ...</think> sections if present
                                while let Some(think_start) = processed_content.find("") {
                                    if let Some(think_end) = processed_content[think_start..].find("</think>") {
                                        processed_content.replace_range(think_start..think_start + think_end + 7, "");
                                    } else {
                                        break;
                                    }
                                }
                                
                                // Also handle escaped versions of the tags
                                while let Some(think_start) = processed_content.find("\\u003cthink\\u003e") {
                                    if let Some(think_end) = processed_content[think_start..].find("\\u003c/think\\u003e") {
                                        processed_content.replace_range(think_start..think_start + think_end + 20, "");
                                    } else {
                                        break;
                                    }
                                }
                                
                                // Trim whitespace
                                processed_content = processed_content.trim().to_string();
                                
                                if !processed_content.is_empty() {
                                    info!("Successfully extracted and processed content from custom provider response");
                                    info!("Final content length: {} chars", processed_content.len());
                                    info!("Final content preview: '{}...'", &processed_content[..processed_content.len().min(100)]);
                                    info!("=== POST-PROCESSING DEBUG END ===");
                                    return Some(processed_content);
                                }
                            }
                        }
                    }
                }
                
                // Fallback: Try to extract the response content directly from the error
                if let Some(content_start) = error_str.find("\"content\":\"") {
                    if let Some(content_end) = error_str[content_start + 11..].find("\",\"role\"") {
                        let content = &error_str[content_start + 11..content_start + 11 + content_end];
                        info!("Successfully extracted content from custom provider response");
                        info!("Extracted content length: {} chars", content.len());
                        info!("Extracted content preview: '{}...'", &content[..content.len().min(100)]);
                        info!("=== POST-PROCESSING DEBUG END ===");
                        return Some(content.to_string());
                    }
                }
                
                // Also check for service_tier specific errors and try to extract content differently
                if error_str.contains("service_tier") && error_str.contains("on_demand") {
                    info!("Detected service_tier 'on_demand' variant issue, attempting alternative parsing...");
                    
                    // Look for content in a different pattern for service_tier errors
                    if let Some(content_start) = error_str.find("\\\"content\\\":\\\"") {
                        if let Some(content_end) = error_str[content_start + 12..].find("\\\"") {
                            let content = &error_str[content_start + 12..content_start + 12 + content_end];
                            // Unescape the JSON string
                            let unescaped_content = content.replace("\\\"", "\"").replace("\\\\", "\\");
                            info!("Successfully extracted content from service_tier error response");
                            info!("Extracted content length: {} chars", unescaped_content.len());
                            info!("Extracted content preview: '{}...'", &unescaped_content[..unescaped_content.len().min(100)]);
                            info!("=== POST-PROCESSING DEBUG END ===");
                            return Some(unescaped_content);
                        }
                    }
                }
            }
            
            error!("LLM post-processing failed for provider '{}': {}", provider.id, e);
            info!("=== POST-PROCESSING DEBUG END ===");
            None
        }
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

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

        // Get the microphone mode to determine audio feedback timing
        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            play_feedback_sound(app, SoundType::Start);

            // Apply mute after audio feedback has time to play (500ms should be enough for most sounds)
            let rm_clone = Arc::clone(&rm);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                rm_clone.apply_mute();
            });

            let recording_started = rm.try_start_recording(&binding_id);
            debug!("Recording started: {}", recording_started);
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            if rm.try_start_recording(&binding_id) {
                debug!("Recording started in {:?}", recording_start_time.elapsed());
                // Small delay to ensure microphone stream is active
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    debug!("Playing delayed audio feedback");
                    play_feedback_sound(&app_clone, SoundType::Start);

                    // Apply mute after audio feedback has time to play
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    rm_clone.apply_mute();
                });
            } else {
                debug!("Failed to start recording");
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task

        tauri::async_runtime::spawn(async move {
            let binding_id = binding_id.clone(); // Clone for the inner async task
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
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
                match tm.transcribe(samples) {
                    Ok(transcription) => {
                        debug!(
                            "Transcription completed in {:?}: '{}'",
                            transcription_time.elapsed(),
                            transcription
                        );
                        if !transcription.is_empty() {
                            let settings = get_settings(&ah);
                            let mut final_text = transcription.clone();
                            let mut post_processed_text: Option<String> = None;
                            let mut post_process_prompt: Option<String> = None;

                            if let Some(processed_text) =
                                maybe_post_process_transcription(&settings, &transcription).await
                            {
                                final_text = processed_text.clone();
                                post_processed_text = Some(processed_text);

                                // Get the prompt that was used
                                if let Some(prompt_id) = &settings.post_process_selected_prompt_id {
                                    if let Some(prompt) = settings
                                        .post_process_prompts
                                        .iter()
                                        .find(|p| &p.id == prompt_id)
                                    {
                                        post_process_prompt = Some(prompt.prompt.clone());
                                    }
                                }
                            }

                            // Save to history with post-processed text and prompt
                            let hm_clone = Arc::clone(&hm);
                            let transcription_for_history = transcription.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = hm_clone
                                    .save_transcription(
                                        samples_clone,
                                        transcription_for_history,
                                        post_processed_text,
                                        post_process_prompt,
                                    )
                                    .await
                                {
                                    error!("Failed to save transcription to history: {}", e);
                                }
                            });

                            // Paste the final text (either processed or original)
                            let ah_clone = ah.clone();
                            let paste_time = Instant::now();
                            ah.run_on_main_thread(move || {
                                match utils::paste(final_text, ah_clone.clone()) {
                                    Ok(()) => debug!(
                                        "Text pasted successfully in {:?}",
                                        paste_time.elapsed()
                                    ),
                                    Err(e) => error!("Failed to paste transcription: {}", e),
                                }
                                // Hide the overlay after transcription is complete
                                utils::hide_recording_overlay(&ah_clone);
                                change_tray_icon(&ah_clone, TrayIconState::Idle);
                            })
                            .unwrap_or_else(|e| {
                                error!("Failed to run paste on main thread: {:?}", e);
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            });
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
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
