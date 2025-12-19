use crate::active_window;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info};
use tauri::AppHandle;

fn clean_response_content(content: &str) -> String {
    let mut text = content
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\");

    while let Some(start) = text.find("<think>") {
        if let Some(end) = text[start..].find("</think>") {
            text.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }

    text.trim().to_string()
}

use tauri::Emitter;

pub(crate) async fn maybe_post_process_transcription(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    show_overlay: bool,
) -> (Option<String>, bool) {
    debug!("=== POST-PROCESSING DEBUG START ===");
    debug!("Post-processing enabled: {}", settings.post_process_enabled);
    debug!("Input transcription length: {} chars", transcription.len());
    if let Some(s) = streaming_transcription {
        debug!("Input streaming transcription length: {} chars", s.len());
    }

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
        return (None, false);
    }

    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => {
            debug!("Selected provider: {} ({})", provider.label, provider.id);
            provider
        }
        None => {
            info!("Post-processing enabled but no provider is selected");
            return (None, false);
        }
    };

    // Determine the prompt to use and the effective input content
    let (prompt, transcription_content) = {
        let transcription_lower = transcription.trim().to_lowercase();

        // Helper to find the longest matching candidate with boundary checks, ignoring spaces
        let find_best_match = |text: &str, candidates: &[String]| -> Option<(String, usize)> {
            let mut best_match: Option<(String, usize)> = None;

            for candidate in candidates {
                let candidate_lower = candidate.trim().to_lowercase();
                if candidate_lower.is_empty() {
                    continue;
                }

                // Flexible matching:
                // We want to verify if `text` starts with `candidate`, ignoring spaces in both.
                // We also need to know the 'end index' in `text` where the match finishes.

                let mut text_chars = text.char_indices();
                let mut cand_chars = candidate_lower.chars();

                let mut matched = true;
                let mut text_match_end_idx = 0;
                let mut last_cand_char = None;

                // Pull first char from candidate
                let mut c_char_opt = cand_chars.next();

                while let Some(c_char) = c_char_opt {
                    if c_char.is_whitespace() {
                        // Skip space in candidate
                        c_char_opt = cand_chars.next();
                        continue;
                    }
                    last_cand_char = Some(c_char);

                    // Find next non-space match in text
                    let mut found_char = false;
                    while let Some((idx, t_char)) = text_chars.next() {
                        if t_char.is_whitespace() {
                            continue;
                        }
                        if t_char == c_char {
                            found_char = true;
                            // Calculate end index (current index + char len)
                            text_match_end_idx = idx + t_char.len_utf8();
                            break;
                        } else {
                            // Mismatch
                            matched = false;
                            break;
                        }
                    }

                    if !found_char || !matched {
                        matched = false;
                        break;
                    }

                    // Next candidate char
                    c_char_opt = cand_chars.next();
                }

                if matched {
                    // We consumed the whole candidate (ignoring its spaces).
                    // text_match_end_idx points to the end of the matched segment in text.

                    // Boundary check at text[text_match_end_idx..]
                    let ends_with_latin =
                        last_cand_char.map_or(false, |c| c.is_ascii_alphanumeric());

                    let is_boundary_ok = if !ends_with_latin {
                        true
                    } else if text_match_end_idx == text.len() {
                        true
                    } else {
                        // Check next char in text
                        let next_char = text[text_match_end_idx..].chars().next();
                        match next_char {
                            Some(c) => !c.is_ascii_alphanumeric(),
                            None => true,
                        }
                    };

                    if is_boundary_ok {
                        if best_match
                            .as_ref()
                            .map_or(true, |(_, len)| text_match_end_idx > *len)
                        {
                            best_match = Some((candidate.clone(), text_match_end_idx));
                        }
                    }
                }
            }
            best_match
        };

        // Parse command prefixes
        let prefixes: Vec<String> = settings
            .command_prefixes
            .as_ref()
            .map(|s| {
                s.split(&[',', '，'][..])
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let has_prefixes_configured = !prefixes.is_empty();

        // Step 1: Check Prefix
        let (content_to_check_alias, prefix_matched) = if has_prefixes_configured {
            if let Some((_, len)) = find_best_match(&transcription_lower, &prefixes) {
                // Strip prefix logic...
                let matched_str_lower = &transcription_lower[..len];
                let char_count = matched_str_lower.chars().count();

                let byte_offset_original = transcription
                    .char_indices()
                    .nth(char_count)
                    .map(|(i, _)| i)
                    .unwrap_or(transcription.len());

                let remaining =
                    transcription[byte_offset_original..].trim_start_matches(|c: char| {
                        c.is_whitespace() || c.is_ascii_punctuation() || "，。！？、".contains(c)
                    });

                (remaining.to_string(), true)
            } else {
                (transcription.to_string(), false)
            }
        } else {
            (transcription.to_string(), true) // No prefixes = implicitly matched
        };

        // Step 2: Check Alias
        let mut matched_prompt_info = None;

        if prefix_matched {
            let content_lower = content_to_check_alias.trim().to_lowercase();

            // Check all prompts for a match
            for p in &settings.post_process_prompts {
                let mut triggers = Vec::new();
                if let Some(alias_str) = &p.alias {
                    triggers.extend(
                        alias_str
                            .split(&[',', '，'][..])
                            .map(|s| s.trim().to_string()),
                    );
                }
                triggers.push(p.name.clone()); // Name is also a trigger

                if let Some((_, len)) = find_best_match(&content_lower, &triggers) {
                    matched_prompt_info = Some((p, len));
                    break;
                }
            }
        }

        if let Some((p, match_len_lower)) = matched_prompt_info {
            // Calculate offset in the content_to_check_alias (original case)
            let matched_substring_lower =
                &content_to_check_alias.trim().to_lowercase()[..match_len_lower];
            let char_count = matched_substring_lower.chars().count();

            let byte_offset = content_to_check_alias
                .char_indices()
                .nth(char_count)
                .map(|(i, _)| i)
                .unwrap_or(content_to_check_alias.len());

            let final_content = content_to_check_alias[byte_offset..]
                .trim_start_matches(|c: char| {
                    c.is_whitespace() || c.is_ascii_punctuation() || "，。！？、".contains(c)
                })
                .to_string();

            (p, final_content)
        } else {
            // Fallback
            let selected_prompt_id = match &settings.post_process_selected_prompt_id {
                Some(id) => id,
                None => {
                    info!("Post-processing skipped because no prompt is selected and no alias matched");
                    return (None, false);
                }
            };

            let p = match settings
                .post_process_prompts
                .iter()
                .find(|p| p.id == *selected_prompt_id)
            {
                Some(p) => p,
                None => {
                    info!(
                        "Post-processing skipped because prompt '{}' was not found",
                        selected_prompt_id
                    );
                    return (None, false);
                }
            };

            (p, transcription.to_string())
        }
    };

    if prompt.prompt.trim().is_empty() {
        info!("Post-processing skipped because the selected prompt is empty");
        return (None, false);
    }

    // Logic to resolve the effective model ID to use
    // Priority:
    // 1. Prompt-specific model (if set, not empty, and valid for current provider)
    // 2. Global default model (if set, not empty, and valid for current provider)
    // 3. Provider's last used/default model

    let resolve_model = |model_id_opt: Option<&String>| -> Option<String> {
        model_id_opt
            .filter(|id| !id.trim().is_empty())
            .and_then(|id| {
                settings
                    .cached_models
                    .iter()
                    .find(|m| m.id == *id && m.provider_id == provider.id)
            })
            .map(|m| m.model_id.clone())
    };

    let model = resolve_model(prompt.model_id.as_ref())
        .or_else(|| resolve_model(settings.selected_prompt_model_id.as_ref()))
        .or_else(|| settings.post_process_models.get(&provider.id).cloned())
        .unwrap_or_default();

    if model.trim().is_empty() {
        info!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return (None, false);
    }

    info!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );
    info!("[LLM Input (Raw)] {}", transcription);
    if transcription_content != transcription {
        info!("[LLM Input (Alias-Trimmed)] {}", transcription_content);
    }

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    let processed_prompt = prompt
        .prompt
        .replace("${output}", &transcription_content)
        .replace("${streaming_output}", streaming_transcription.unwrap_or(""));

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                debug!("Apple Intelligence selected but not currently available on this device");
                let _ = app_handle.emit(
                    "overlay-error",
                    serde_json::json!({ "code": "apple_intelligence_unavailable" }),
                );
                return (None, true);
            }

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(&processed_prompt, token_limit) {
                Ok(result) => {
                    if result.trim().is_empty() {
                        (None, false)
                    } else {
                        (Some(result), false)
                    }
                }
                Err(err) => {
                    error!("Apple Intelligence post-processing failed: {}", err);
                    let _ = app_handle.emit(
                        "overlay-error",
                        serde_json::json!({ "code": "apple_intelligence_failed", "message": format!("Apple Intelligence Error: {}", err) }),
                    );
                    (None, true)
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            debug!("Apple Intelligence provider selected on unsupported platform");
            return (None, false);
        }
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = match crate::llm_client::create_client(&provider, api_key) {
        Ok(client) => client,
        Err(err) => {
            error!(
                "Failed to create LLM client for provider '{}': {}",
                provider.id, err
            );
            let _ = app_handle.emit(
                "overlay-error",
                serde_json::json!({ "code": "llm_init_failed", "message": format!("Init Error: {}", err) }),
            );
            return (None, true);
        }
    };

    let active_window_snapshot = active_window::fetch_active_window().ok();
    if let Some(info) = &active_window_snapshot {
        debug!(
            "Active window during post-processing: app='{}' title='{}' pid={} window_id={}",
            info.app_name, info.title, info.process_id, info.window_id
        );
    }

    let msg = ChatCompletionRequestUserMessageArgs::default()
        .content(processed_prompt)
        .build()
        .ok()
        .map(ChatCompletionRequestMessage::User);

    if msg.is_none() {
        return (None, false);
    }
    let msg = msg.unwrap();

    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(vec![msg])
        .build()
        .ok();

    if req.is_none() {
        return (None, false);
    }
    let req = req.unwrap();

    let resp = match client.chat().create(req).await {
        Ok(resp) => resp,
        Err(err) => {
            // Keep existing fallback behavior: try to extract some content from errors.
            let error_str = format!("{:?}", err);
            error!("Post-processing request failed: {}", error_str);

            if let Some(content_start) = error_str.find("\\\"content\\\":\\\"") {
                if let Some(content_end) = error_str[content_start + 12..].find("\\\"") {
                    let content = &error_str[content_start + 12..content_start + 12 + content_end];
                    return (Some(clean_response_content(content)), false);
                }
            }

            let _ = app_handle.emit(
                "overlay-error",
                serde_json::json!({ "code": "llm_request_failed", "message": format!("Request Error: {}", err) }),
            );

            return (None, true);
        }
    };

    let content = resp
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .unwrap_or_default();

    let out = clean_response_content(&content);
    if out.trim().is_empty() {
        (None, false)
    } else {
        info!("[LLM Output (Post-processed)] {}", out);
        debug!("=== POST-PROCESSING DEBUG END ===");
        (Some(out), false)
    }
}

pub(crate) async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    let config = if is_simplified {
        BuiltinConfig::Tw2sp
    } else {
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => Some(converter.convert(transcription)),
        Err(e) => {
            error!(
                "Failed to initialize OpenCC converter: {}. Falling back to original transcription.",
                e
            );
            None
        }
    }
}
