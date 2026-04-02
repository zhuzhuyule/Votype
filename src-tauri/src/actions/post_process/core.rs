#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::settings::{
    AppSettings, PostProcessProvider, PromptMessageRole, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use async_openai::types::{
    ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestDeveloperMessageArgs,
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs,
};
use log::{error, info};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

pub(crate) fn preview_multiline(label: &str, content: &str) {
    log::info!(
        "[LLM] {} (len={}):\n{}",
        label,
        content.chars().count(),
        content
    );
}

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

pub(super) fn extract_rewrite_response(content: &str) -> Option<super::RewriteResponse> {
    let cleaned = clean_response_content(content);
    let json = extract_json_block(&cleaned).unwrap_or(cleaned);
    if let Ok(parsed) = serde_json::from_str::<super::RewriteResponse>(&json) {
        return Some(parsed);
    }

    salvage_rewrite_response(&json)
}

fn extract_json_string_field(content: &str, field_name: &str) -> Option<String> {
    let field_pattern = format!(r#""{}"\s*:\s*""#, regex::escape(field_name));
    let re = regex::Regex::new(&field_pattern).ok()?;
    let mat = re.find(content)?;
    let start = mat.end();
    let mut escaped = false;
    let mut result = String::new();

    for ch in content[start..].chars() {
        if escaped {
            result.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => return Some(result),
            other => result.push(other),
        }
    }

    None
}

fn salvage_rewrite_response(content: &str) -> Option<super::RewriteResponse> {
    let rewritten_text = extract_json_string_field(content, "rewritten_text")?;
    let normalized_instruction =
        extract_json_string_field(content, "normalized_instruction").unwrap_or_default();
    let operation =
        extract_json_string_field(content, "operation").unwrap_or_else(|| "rewrite".to_string());

    Some(super::RewriteResponse {
        normalized_instruction,
        operation,
        rewritten_text,
        changes: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::extract_rewrite_response;

    #[test]
    fn test_extract_rewrite_response_salvages_invalid_json_with_rewritten_text() {
        let raw = r#"{
"normalized_instruction": "没有 token 消耗，不是头坑。",
"operation": "rewrite",
"rewritten_text": "我怎么看着他这块显示的还是之前你给显示的那种内容呢？没有 token 消耗呢？",
此文稿中“没有头可能消耗呢？”应为“没有 token 消耗呢？”，结合上下文及术语参考中的“usage”“LLM”等词，用户实际想表达的是大模型调用中未显示 token 消耗情况，而非字面“头坑”（ASR 误识别）。",
"changes": [
{
"from": "没有头可能消耗呢？",
"to": "没有 token 消耗呢？",
"reason": "根据 spoken_instruction 判断为 ASR 错误"
}
]
}"#;

        let parsed = extract_rewrite_response(raw).expect("should salvage rewritten_text");
        assert_eq!(parsed.operation, "rewrite");
        assert_eq!(
            parsed.rewritten_text,
            "我怎么看着他这块显示的还是之前你给显示的那种内容呢？没有 token 消耗呢？"
        );
    }
}

pub(crate) fn resolve_prompt_message_role(
    settings: &AppSettings,
    provider_id: &str,
    cached_model_id: Option<&str>,
    model_id: &str,
) -> PromptMessageRole {
    settings
        .cached_models
        .iter()
        .find(|m| {
            cached_model_id
                .map(|id| m.id == id && m.provider_id == provider_id)
                .unwrap_or(false)
                || (m.provider_id == provider_id && m.model_id == model_id)
        })
        .map(|m| m.prompt_message_role)
        .unwrap_or_default()
}

pub(crate) fn build_instruction_message(
    role: PromptMessageRole,
    content: impl Into<String>,
) -> Option<ChatCompletionRequestMessage> {
    let content = content.into();
    match role {
        PromptMessageRole::Developer => ChatCompletionRequestDeveloperMessageArgs::default()
            .content(content)
            .build()
            .ok()
            .map(ChatCompletionRequestMessage::Developer),
        PromptMessageRole::System => ChatCompletionRequestSystemMessageArgs::default()
            .content(content)
            .build()
            .ok()
            .map(ChatCompletionRequestMessage::System),
    }
}

pub(crate) fn build_user_message(
    content: impl Into<String>,
) -> Option<ChatCompletionRequestMessage> {
    ChatCompletionRequestUserMessageArgs::default()
        .content(content.into())
        .build()
        .ok()
        .map(ChatCompletionRequestMessage::User)
}

pub(crate) fn build_assistant_message(
    content: impl Into<String>,
) -> Option<ChatCompletionRequestMessage> {
    ChatCompletionRequestAssistantMessageArgs::default()
        .content(content.into())
        .build()
        .ok()
        .map(ChatCompletionRequestMessage::Assistant)
}

pub async fn execute_llm_request(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompt: &str,
    user_message: Option<&str>,
    _app_name: Option<String>,
    _window_title: Option<String>,
    _match_pattern: Option<String>,
    _match_type: Option<crate::settings::TitleMatchType>,
) -> (Option<String>, bool, Option<String>, Option<i64>) {
    let prompts = vec![system_prompt.to_string()];
    execute_llm_request_with_messages(
        app_handle,
        settings,
        provider,
        model,
        cached_model_id,
        &prompts,
        user_message,
        None,
        _app_name,
        _window_title,
        _match_pattern,
        _match_type,
        None,
    )
    .await
}

pub async fn execute_llm_request_with_messages(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    conversation_history: Option<&[crate::review_window::RewriteMessage]>,
    _app_name: Option<String>,
    _window_title: Option<String>,
    _match_pattern: Option<String>,
    _match_type: Option<crate::settings::TitleMatchType>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> (Option<String>, bool, Option<String>, Option<i64>) {
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                let _ = app_handle.emit(
                    "overlay-error",
                    serde_json::json!({ "code": "apple_intelligence_unavailable" }),
                );
                return (
                    None,
                    true,
                    Some("Apple Intelligence 不可用".to_string()),
                    None,
                );
            }

            // Combine messages for Apple Intelligence
            let mut final_prompt = system_prompts.join("\n\n---\n\n");
            if let Some(user_msg) = user_message {
                final_prompt = format!("{}\n\n{}", final_prompt, user_msg);
            }

            info!(
                "Apple Intelligence Request | Model: {} | Prompt: {}",
                model, final_prompt
            );

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(&final_prompt, token_limit) {
                Ok(result) => (Some(result), false, None, None),
                Err(err) => {
                    error!("Apple Intelligence failed: {}", err);
                    let _ = app_handle.emit(
                        "overlay-error",
                        serde_json::json!({
                            "code": "apple_intelligence_failed",
                            "message": format!("Apple Intelligence 请求失败: {}", err),
                        }),
                    );
                    (
                        None,
                        true,
                        Some(format!("Apple Intelligence 请求失败: {}", err)),
                        None,
                    )
                }
            };
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        return (None, false, None, None);
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
                serde_json::json!({
                    "code": "llm_init_failed",
                    "message": format!(
                        "LLM 客户端初始化失败 provider={} model={} url={}: {}",
                        provider.id,
                        model,
                        provider.base_url.trim_end_matches('/'),
                        e
                    ),
                }),
            );
            return (
                None,
                true,
                Some(format!(
                    "LLM 客户端初始化失败 provider={} model={} url={}: {}",
                    provider.id,
                    model,
                    provider.base_url.trim_end_matches('/'),
                    e
                )),
                None,
            );
        }
    };

    // Build messages list
    let mut messages: Vec<ChatCompletionRequestMessage> = Vec::new();
    let prompt_message_role =
        resolve_prompt_message_role(settings, &provider.id, cached_model_id, model);

    // 1. Single instruction message (system / developer)
    for system_prompt in system_prompts {
        if let Some(msg) = build_instruction_message(prompt_message_role, system_prompt.clone()) {
            messages.push(msg);
        }
    }

    // 2. Insert conversation history between system prompts and the new user message
    if let Some(history) = conversation_history {
        for msg in history {
            let chat_msg = match msg.role {
                crate::review_window::RewriteRole::User => build_user_message(&msg.content),
                crate::review_window::RewriteRole::Assistant => {
                    build_assistant_message(&msg.content)
                }
            };
            if let Some(m) = chat_msg {
                messages.push(m);
            }
        }
    }

    // 3. Single user message
    if let Some(user_content) = user_message {
        if let Some(msg) = build_user_message(user_content) {
            messages.push(msg);
        }
    }

    if messages.is_empty() {
        return (None, false, None, None);
    }

    if crate::DEBUG_LOG_POST_PROCESS.load(std::sync::atomic::Ordering::Relaxed) {
        log::info!(
            "[LLM] PromptContext: provider={} model={} cached_model_id={:?} system_prompts={} user_message={}",
            provider.id,
            model,
            cached_model_id,
            system_prompts.len(),
            user_message.is_some()
        );
        for (index, prompt) in system_prompts.iter().enumerate() {
            preview_multiline(&format!("SystemPrompt[{}]", index), prompt);
        }
        if let Some(user_content) = user_message {
            preview_multiline("UserMessage", user_content);
        }
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
    let extra_params =
        override_extra_params.or_else(|| cached_model.and_then(|m| m.extra_params.as_ref()));
    let extra_headers = cached_model.and_then(|m| m.extra_headers.as_ref());

    // Build the request body JSON
    let messages_json: Vec<serde_json::Value> = messages
        .into_iter()
        .filter_map(|m| serde_json::to_value(m).ok())
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages_json,
    });

    // Add structured output response_format when supported
    if provider.supports_structured_output {
        if let Some(obj) = body.as_object_mut() {
            obj.insert(
                "response_format".to_string(),
                serde_json::json!({
                    "type": "json_schema",
                    "json_schema": {
                        "name": "transcription_output",
                        "strict": true,
                        "schema": {
                            "type": "object",
                            "properties": {
                                TRANSCRIPTION_FIELD: {
                                    "type": "string",
                                    "description": "The cleaned and processed transcription text"
                                }
                            },
                            "required": [TRANSCRIPTION_FIELD],
                            "additionalProperties": false
                        }
                    }
                }),
            );
        }
    }

    // Auto-inject thinking params based on is_thinking_model flag (lower priority than user extra_params)
    if let Some(cm) = cached_model {
        if let Some(thinking_params) = crate::settings::thinking_extra_params_with_aliases(
            &cm.model_id,
            &cm.provider_id,
            cm.is_thinking_model,
            &[cm.custom_label.as_deref().unwrap_or("")],
        ) {
            if let Some(obj) = body.as_object_mut() {
                for (k, v) in &thinking_params {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
    }

    // Merge extra params if provided (user params override auto-injected thinking params)
    if let Some(extras) = extra_params {
        if let Some(obj) = body.as_object_mut() {
            for (k, v) in extras {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    // Log request summary with actual parameter values
    let param_snapshot: std::collections::HashMap<&str, &serde_json::Value> = body
        .as_object()
        .map(|obj| {
            obj.iter()
                .filter(|(k, _)| *k != "messages" && *k != "response_format")
                .map(|(k, v)| (k.as_str(), v))
                .collect()
        })
        .unwrap_or_default();
    if crate::DEBUG_LOG_POST_PROCESS.load(std::sync::atomic::Ordering::Relaxed) {
        info!(
            "[LLM] Request: provider={} model={} cached_model_id={:?} body_params={:?}",
            provider.id, model, cached_model_id, param_snapshot
        );
        if log::log_enabled!(log::Level::Debug) {
            if let Ok(pretty_body) = serde_json::to_string_pretty(&body) {
                log::debug!(
                    "[LLM] RequestBody provider={} model={}:\n{}",
                    provider.id,
                    model,
                    pretty_body
                );
            }
        }
    }

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
    // Apply provider-level custom headers
    if let Some(custom) = &provider.custom_headers {
        for (k, v) in custom {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                headers.insert(name, val);
            }
        }
    }
    // Apply model-level extra headers
    if let Some(custom) = extra_headers {
        for (k, v) in custom {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                headers.insert(name, val);
            }
        }
    }
    let sanitized_headers: Vec<(String, String)> = headers
        .iter()
        .map(|(name, value)| {
            let header_name = name.as_str().to_string();
            let header_value = if header_name.eq_ignore_ascii_case("authorization") {
                "Bearer ***".to_string()
            } else {
                value.to_str().unwrap_or("<non-utf8>").to_string()
            };
            (header_name, header_value)
        })
        .collect();
    if crate::DEBUG_LOG_POST_PROCESS.load(std::sync::atomic::Ordering::Relaxed) {
        info!(
            "[LLM] RequestMeta provider={} model={} url={}",
            provider.id, model, url
        );
        for (name, value) in &sanitized_headers {
            log::debug!("[LLM] Header {}: {}", name, value);
        }
    }
    let http_client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(60)) // Increase timeout for Thinking models
        .build();

    match http_client {
        Ok(client) => {
            match client.post(&url).json(&body).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        match resp.json::<serde_json::Value>().await {
                            Ok(json_resp) => {
                                if crate::DEBUG_LOG_POST_PROCESS
                                    .load(std::sync::atomic::Ordering::Relaxed)
                                    && log::log_enabled!(log::Level::Debug)
                                {
                                    if let Ok(pretty_resp) =
                                        serde_json::to_string_pretty(&json_resp)
                                    {
                                        log::debug!(
                                            "[LLM] ResponseBody (len={}):\n{}",
                                            pretty_resp.len(),
                                            pretty_resp
                                        );
                                    }
                                }
                                // Extract content from OpenAI-compatible response
                                let raw_content = &json_resp["choices"][0]["message"]["content"];
                                let content = raw_content
                                    .as_str()
                                    .unwrap_or_default()
                                    .replace('\u{200B}', "") // Zero-Width Space
                                    .replace('\u{200C}', "") // Zero-Width Non-Joiner
                                    .replace('\u{200D}', "") // Zero-Width Joiner
                                    .replace('\u{FEFF}', ""); // Byte Order Mark / Zero-Width No-Break Space

                                // Detect thinking mode from response
                                let message_obj = &json_resp["choices"][0]["message"];
                                let reasoning = message_obj["reasoning_content"]
                                    .as_str()
                                    .or_else(|| message_obj["reasoning"].as_str())
                                    .or_else(|| message_obj["thinking"].as_str());
                                let has_think_tags =
                                    content.contains("<think>") || content.contains("</think>");
                                let is_thinking = reasoning.is_some() || has_think_tags;

                                if crate::DEBUG_LOG_POST_PROCESS
                                    .load(std::sync::atomic::Ordering::Relaxed)
                                {
                                    info!(
                                        "[LLM] Response: model={} content_len={} thinking={} reasoning_len={}",
                                        model,
                                        content.len(),
                                        is_thinking,
                                        reasoning.map(|r| r.len()).unwrap_or(0)
                                    );
                                    preview_multiline("ResponseContentRaw", &content);
                                    if let Some(reasoning_text) = reasoning {
                                        preview_multiline("ResponseReasoning", reasoning_text);
                                    }
                                }

                                // When structured output is enabled, try to parse JSON
                                // and extract the transcription field
                                let text = if provider.supports_structured_output {
                                    match serde_json::from_str::<serde_json::Value>(&content) {
                                        Ok(json) => {
                                            if let Some(t) = json
                                                .get(TRANSCRIPTION_FIELD)
                                                .and_then(|v| v.as_str())
                                            {
                                                info!(
                                                    "[LLM] Structured output extracted '{}' field ({} chars)",
                                                    TRANSCRIPTION_FIELD,
                                                    t.len()
                                                );
                                                t.to_string()
                                            } else {
                                                log::warn!(
                                                    "[LLM] Structured output missing '{}' field, falling back to text extraction",
                                                    TRANSCRIPTION_FIELD
                                                );
                                                extract_llm_text(&content)
                                            }
                                        }
                                        Err(_) => {
                                            log::warn!(
                                                "[LLM] Structured output JSON parse failed, falling back to text extraction"
                                            );
                                            extract_llm_text(&content)
                                        }
                                    }
                                } else {
                                    extract_llm_text(&content)
                                };
                                if text != content
                                    && crate::DEBUG_LOG_POST_PROCESS
                                        .load(std::sync::atomic::Ordering::Relaxed)
                                {
                                    preview_multiline("ResponseText", &text);
                                }
                                let token_count = json_resp
                                    .get("usage")
                                    .and_then(|u| u.get("total_tokens"))
                                    .and_then(|t| t.as_i64());
                                return (Some(text), false, None, token_count);
                            }
                            Err(e) => {
                                error!("Failed to parse LLM JSON response: {:?}", e);
                                let detail = format!(
                                    "LLM 响应解析失败 provider={} model={} url={}: {:?}",
                                    provider.id, model, url, e
                                );
                                let _ = app_handle.emit(
                                    "overlay-error",
                                    serde_json::json!({
                                        "code": "llm_request_failed",
                                        "message": detail,
                                    }),
                                );
                                return (None, true, Some(detail), None);
                            }
                        }
                    } else {
                        let status = resp.status();
                        let error_text = resp.text().await.unwrap_or_default();
                        error!("LLM request failed with status {}: {}", status, error_text);
                        let detail = format!(
                            "LLM 请求失败 provider={} model={} url={} status={}: {}",
                            provider.id, model, url, status, error_text
                        );
                        let _ = app_handle.emit(
                            "overlay-error",
                            serde_json::json!({
                                "code": "llm_request_failed",
                                "message": detail,
                            }),
                        );
                        return (None, true, Some(detail), None);
                    }
                }
                Err(err) => {
                    error!("LLM request network error: {:?}", err);
                    let detail = format!(
                        "LLM 网络请求失败 provider={} model={} url={}: {:?}",
                        provider.id, model, url, err
                    );
                    let _ = app_handle.emit(
                        "overlay-error",
                        serde_json::json!({
                            "code": "llm_request_failed",
                            "message": detail,
                        }),
                    );
                    return (None, true, Some(detail), None);
                }
            }
        }
        Err(e) => {
            error!("Failed to create HTTP client: {}", e);
            let detail = format!(
                "HTTP 客户端创建失败 provider={} model={} url={}: {}",
                provider.id, model, url, e
            );
            let _ = app_handle.emit(
                "overlay-error",
                serde_json::json!({
                    "code": "llm_request_failed",
                    "message": detail,
                }),
            );
            return (None, true, Some(detail), None);
        }
    }
}
