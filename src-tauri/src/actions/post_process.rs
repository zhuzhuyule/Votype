#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{
    AppSettings, LLMPrompt, PostProcessProvider, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{error, info};
use tauri::{AppHandle, Emitter};

fn clean_response_content(content: &str) -> String {
    let mut text = content
        .replace("\n", "\n")
        .replace("\t", "\t")
        .replace("\"", "\"")
        .replace("\\", "\\");

    while let Some(start) = text.find("<think>") {
        if let Some(end) = text[start..].find("</think>") {
            text.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }

    text.trim().to_string()
}

fn resolve_effective_model(
    settings: &AppSettings,
    provider: &PostProcessProvider,
    prompt: &LLMPrompt,
) -> Option<String> {
    let resolve_from_id = |model_id_opt: Option<&String>| -> Option<String> {
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

    resolve_from_id(prompt.model_id.as_ref())
        .or_else(|| resolve_from_id(settings.selected_prompt_model_id.as_ref()))
        .or_else(|| settings.post_process_models.get(&provider.id).cloned())
        .filter(|m| !m.trim().is_empty())
}

async fn execute_llm_request(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    processed_prompt: &str,
) -> (Option<String>, bool) {
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                let _ = app_handle.emit(
                    "overlay-error",
                    serde_json::json!({ "code": "apple_intelligence_unavailable" }),
                );
                return (None, true);
            }

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(processed_prompt, token_limit) {
                Ok(result) => (Some(result), false),
                Err(err) => {
                    error!("Apple Intelligence failed: {}", err);
                    let _ = app_handle.emit(
                        "overlay-error",
                        serde_json::json!({ "code": "apple_intelligence_failed" }),
                    );
                    (None, true)
                }
            };
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        return (None, false);
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = match crate::llm_client::create_client(provider, api_key) {
        Ok(client) => client,
        Err(e) => {
            error!("Failed to create LLM client: {}", e);
            let _ = app_handle.emit(
                "overlay-error",
                serde_json::json!({ "code": "llm_init_failed" }),
            );
            return (None, true);
        }
    };

    let msg = ChatCompletionRequestUserMessageArgs::default()
        .content(processed_prompt.to_string())
        .build()
        .ok()
        .map(ChatCompletionRequestMessage::User);

    if let Some(msg) = msg {
        let req = CreateChatCompletionRequestArgs::default()
            .model(model.to_string())
            .messages(vec![msg])
            .build()
            .ok();

        if let Some(req) = req {
            match client.chat().create(req).await {
                Ok(resp) => {
                    let content = resp
                        .choices
                        .first()
                        .and_then(|c| c.message.content.clone())
                        .unwrap_or_default();
                    return (Some(clean_response_content(&content)), false);
                }
                Err(err) => {
                    error!("LLM request failed: {:?}", err);
                    let _ = app_handle.emit(
                        "overlay-error",
                        serde_json::json!({ "code": "llm_request_failed" }),
                    );
                    return (None, true);
                }
            }
        }
    }

    (None, false)
}

pub(crate) async fn maybe_post_process_transcription(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    show_overlay: bool,
) -> (Option<String>, Option<String>, Option<String>, bool) {
    if !settings.post_process_enabled {
        return (None, None, None, false);
    }

    let provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false),
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

                let mut text_chars = text.char_indices();
                let mut cand_chars = candidate_lower.chars();

                let mut matched = true;
                let mut text_match_end_idx = 0;
                let mut last_cand_char = None;

                let mut c_char_opt = cand_chars.next();

                while let Some(c_char) = c_char_opt {
                    if c_char.is_whitespace() {
                        c_char_opt = cand_chars.next();
                        continue;
                    }
                    last_cand_char = Some(c_char);

                    let mut found_char = false;
                    while let Some((idx, t_char)) = text_chars.next() {
                        if t_char.is_whitespace() {
                            continue;
                        }
                        if t_char == c_char {
                            found_char = true;
                            text_match_end_idx = idx + t_char.len_utf8();
                            break;
                        } else {
                            matched = false;
                            break;
                        }
                    }

                    if !found_char || !matched {
                        matched = false;
                        break;
                    }
                    c_char_opt = cand_chars.next();
                }

                if matched {
                    let ends_with_latin =
                        last_cand_char.map_or(false, |c| c.is_ascii_alphanumeric());

                    let is_boundary_ok = if !ends_with_latin {
                        true
                    } else if text_match_end_idx == text.len() {
                        true
                    } else {
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

        let (content_to_check_alias, prefix_matched) = if has_prefixes_configured {
            if let Some((_, len)) = find_best_match(&transcription_lower, &prefixes) {
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
            (transcription.to_string(), true)
        };

        let mut matched_prompt_info = None;

        if prefix_matched {
            let content_lower = content_to_check_alias.trim().to_lowercase();

            for p in &settings.post_process_prompts {
                let mut triggers = Vec::new();
                if let Some(alias_str) = &p.alias {
                    triggers.extend(
                        alias_str
                            .split(&[',', '，'][..])
                            .map(|s| s.trim().to_string()),
                    );
                }
                triggers.push(p.name.clone());

                if let Some((_, len)) = find_best_match(&content_lower, &triggers) {
                    matched_prompt_info = Some((p, len));
                    break;
                }
            }
        }

        if let Some((p, match_len_lower)) = matched_prompt_info {
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
            let selected_prompt_id = match &settings.post_process_selected_prompt_id {
                Some(id) => id,
                None => return (None, None, None, false),
            };

            let p = match settings
                .post_process_prompts
                .iter()
                .find(|p| p.id == *selected_prompt_id)
            {
                Some(p) => p,
                None => return (None, None, None, false),
            };

            (p, transcription.to_string())
        }
    };

    let model = match resolve_effective_model(settings, provider, prompt) {
        Some(m) => m,
        None => return (None, None, Some(prompt.id.clone()), false),
    };

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    let processed_prompt = prompt
        .prompt
        .replace("${output}", &transcription_content)
        .replace("${streaming_output}", streaming_transcription.unwrap_or(""));

    let (result, err) =
        execute_llm_request(app_handle, settings, provider, &model, &processed_prompt).await;
    (result, Some(model), Some(prompt.id.clone()), err)
}

pub(crate) async fn post_process_text_with_prompt(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    prompt: &LLMPrompt,
    show_overlay: bool,
) -> (Option<String>, Option<String>, Option<String>, bool) {
    let provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false),
    };

    let model = match resolve_effective_model(settings, provider, prompt) {
        Some(m) => m,
        None => return (None, None, Some(prompt.id.clone()), false),
    };

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    let processed_prompt = prompt
        .prompt
        .replace("${output}", transcription)
        .replace("${streaming_output}", streaming_transcription.unwrap_or(""));

    let (result, err) =
        execute_llm_request(app_handle, settings, provider, &model, &processed_prompt).await;

    if let Some(res) = &result {
        info!(
            "Manual LLM Task Completed | Model: {} | Result: {}...",
            model,
            res.chars().take(50).collect::<String>()
        );
    }

    (result, Some(model), Some(prompt.id.clone()), err)
}

pub(crate) async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
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
            error!("Failed to initialize OpenCC converter: {}", e);
            None
        }
    }
}
