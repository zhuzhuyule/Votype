#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::settings::{AppSettings, PostProcessProvider, APPLE_INTELLIGENCE_PROVIDER_ID};
use log::{error, info};
use tauri::{AppHandle, Emitter};

pub(super) fn clean_response_content(content: &str) -> String {
    let mut text = content.to_string();

    while let Some(start) = text.find("<think>") {
        if let Some(end) = text[start..].find("</think>") {
            text.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }

    text.trim().to_string()
}

pub(super) fn extract_json_block(content: &str) -> Option<String> {
    if let Some(start) = content.find("```json") {
        let rest = &content[start + 7..];
        if let Some(end) = rest.find("```") {
            return Some(rest[..end].trim().to_string());
        }
    }
    if let Some(start) = content.find("```") {
        let rest = &content[start + 3..];
        if let Some(end) = rest.find("```") {
            return Some(rest[..end].trim().to_string());
        }
    }
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    if end > start {
        return Some(content[start..=end].trim().to_string());
    }
    None
}

/// Extract text from LLM response.
/// Handles both plain text and JSON `{"text":"..."}` formats (for user-custom prompts).
pub(super) fn extract_llm_text(content: &str) -> String {
    let cleaned = clean_response_content(content);

    // Try JSON extraction for backward compatibility with custom prompts
    if let Some(json) = extract_json_block(&cleaned) {
        if let Ok(parsed) = serde_json::from_str::<super::LlmReviewResponse>(&json) {
            if let Some(text) = parsed.text {
                return text;
            }
        }
    }

    cleaned
}

pub async fn execute_llm_request(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    prompt_content: &str,
    input_data_message: Option<&str>,
    fallback_message: Option<&str>,
    history: Vec<String>,
    _app_name: Option<String>,
    _window_title: Option<String>,
    _match_pattern: Option<String>,
    _match_type: Option<crate::settings::TitleMatchType>,
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

            let mut final_prompt = prompt_content.to_string();
            // Append input data if provided
            if let Some(input_data) = input_data_message {
                final_prompt = format!("{}\n\n{}", final_prompt, input_data);
            }
            if !history.is_empty() {
                let context_block = format!(
                    "\n\n[ASR上下文] 当前应用近期识别的上下文,用于推断讨论的领域和话题,仅供语境参考。\n{}\n\n",
                    history
                        .iter()
                        .map(|s| format!("- {}", s))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                final_prompt = format!("{}{}", context_block, final_prompt);
            }

            info!(
                "Apple Intelligence Request | Model: {} | Prompt: {}",
                model, final_prompt
            );

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(&final_prompt, token_limit) {
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

    let _client = match crate::llm_client::create_client(provider, api_key.clone()) {
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

    // Build messages list
    let mut messages: Vec<async_openai::types::ChatCompletionRequestMessage> = Vec::new();

    // 1. System message: processing instructions
    if let Ok(sys_msg) = async_openai::types::ChatCompletionRequestSystemMessageArgs::default()
        .content(prompt_content.to_string())
        .build()
    {
        messages.push(async_openai::types::ChatCompletionRequestMessage::System(
            sys_msg,
        ));
    }

    // 2. History context as a separate System message (reference only)
    if !history.is_empty() {
        let history_block = format!(
            "[ASR上下文] 当前应用近期识别的上下文,用于推断讨论的领域和话题,仅供语境参考。\n{}",
            history.join("\n")
        );

        if let Ok(ctx_msg) = async_openai::types::ChatCompletionRequestSystemMessageArgs::default()
            .content(history_block)
            .build()
        {
            messages.push(async_openai::types::ChatCompletionRequestMessage::System(
                ctx_msg,
            ));
        }
    }

    // 3. User message: actual input data to process (transcription + hotwords)
    if let Some(input_data) = input_data_message {
        if let Ok(input_msg) = async_openai::types::ChatCompletionRequestUserMessageArgs::default()
            .content(input_data.to_string())
            .build()
        {
            messages.push(async_openai::types::ChatCompletionRequestMessage::User(
                input_msg,
            ));
        }
    }

    // 4. Fallback: raw transcription when prompt doesn't reference output/select
    if let Some(fallback) = fallback_message {
        if let Ok(fallback_msg) =
            async_openai::types::ChatCompletionRequestUserMessageArgs::default()
                .content(fallback.to_string())
                .build()
        {
            messages.push(async_openai::types::ChatCompletionRequestMessage::User(
                fallback_msg,
            ));
        }
    }

    if messages.is_empty() {
        return (None, false);
    }

    // Resolve CachedModel to get extra_params and is_thinking_model
    let cached_model = cached_model_id.and_then(|id| {
        settings
            .cached_models
            .iter()
            .find(|m| m.id == id && m.provider_id == provider.id)
    });
    let cached_model = cached_model.or_else(|| {
        settings
            .cached_models
            .iter()
            .find(|m| m.model_id == model && m.provider_id == provider.id)
    });
    let extra_params = cached_model.and_then(|m| m.extra_params.as_ref());

    // Build the request body JSON
    let messages_json: Vec<serde_json::Value> = messages
        .into_iter()
        .filter_map(|m| serde_json::to_value(m).ok())
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages_json,
    });

    // Merge extra params if provided
    if let Some(extras) = extra_params {
        if let Some(obj) = body.as_object_mut() {
            for (k, v) in extras {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    info!(
        "[LLM] Post-process request: provider={}, model={}, url={}/chat/completions\n{}",
        provider.id,
        model,
        provider.base_url.trim_end_matches('/'),
        serde_json::to_string_pretty(&body).unwrap_or_else(|_| body.to_string())
    );

    // Manual HTTP request to allow arbitrary parameters and handle response flexibly
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key))
            .unwrap_or_else(|_| reqwest::header::HeaderValue::from_static("")),
    );
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    if provider.id == "anthropic" {
        headers.insert(
            "anthropic-version",
            reqwest::header::HeaderValue::from_static("2023-06-01"),
        );
    }
    let http_client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(60)) // Increase timeout for Thinking models
        .build();

    match http_client {
        Ok(client) => {
            match client.post(url).json(&body).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        match resp.json::<serde_json::Value>().await {
                            Ok(json_resp) => {
                                // Extract content from OpenAI-compatible response
                                let raw_content = &json_resp["choices"][0]["message"]["content"];
                                let content = raw_content
                                    .as_str()
                                    .unwrap_or_default()
                                    .replace('\u{200B}', "") // Zero-Width Space
                                    .replace('\u{200C}', "") // Zero-Width Non-Joiner
                                    .replace('\u{200D}', "") // Zero-Width Joiner
                                    .replace('\u{FEFF}', ""); // Byte Order Mark / Zero-Width No-Break Space

                                // Check reasoning_content for thinking mode models
                                let reasoning = json_resp["choices"][0]["message"]
                                    ["reasoning_content"]
                                    .as_str();
                                if let Some(r) = reasoning {
                                    info!("[LLM] Received reasoning content (len={})", r.len());
                                }

                                info!(
                                    "[LLM] Post-process raw response ({} chars):\n{}",
                                    content.len(),
                                    content
                                );

                                let text = extract_llm_text(&content);
                                return (Some(text), false);
                            }
                            Err(e) => {
                                error!("Failed to parse LLM JSON response: {:?}", e);
                            }
                        }
                    } else {
                        let status = resp.status();
                        let error_text = resp.text().await.unwrap_or_default();
                        error!("LLM request failed with status {}: {}", status, error_text);
                    }
                }
                Err(err) => {
                    error!("LLM request network error: {:?}", err);
                }
            }
        }
        Err(e) => {
            error!("Failed to create HTTP client: {}", e);
        }
    }

    let _ = app_handle.emit(
        "overlay-error",
        serde_json::json!({ "code": "llm_request_failed" }),
    );
    (None, true)
}
