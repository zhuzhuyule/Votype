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
use log::info;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

/// Structured error type for LLM API calls.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum LlmError {
    /// reqwest client creation failed
    ClientInit {
        provider: String,
        model: String,
        detail: String,
    },
    /// Network-level failure (DNS, connection, timeout)
    Network {
        provider: String,
        model: String,
        url: String,
        detail: String,
    },
    /// HTTP response with non-2xx status
    ApiError {
        provider: String,
        model: String,
        status: u16,
        body: String,
    },
    /// Response body could not be parsed
    ParseError {
        provider: String,
        model: String,
        detail: String,
    },
    /// Apple Intelligence specific error
    AppleIntelligence { detail: String },
}

#[allow(dead_code)]
impl LlmError {
    /// Whether this error is worth retrying
    pub fn is_retryable(&self) -> bool {
        match self {
            LlmError::Network { .. } => true,
            LlmError::ApiError { status, .. } => *status == 429 || *status >= 500,
            _ => false,
        }
    }

    /// Suggested retry delay in ms for a given attempt (0-indexed)
    pub fn retry_delay_ms(&self, attempt: u32) -> u64 {
        match self {
            LlmError::ApiError { status: 429, .. } => 1000,
            LlmError::Network { .. } if attempt == 0 => 0,
            LlmError::Network { .. } => 500,
            LlmError::ApiError { status, .. } if *status >= 500 && attempt == 0 => 0,
            LlmError::ApiError { .. } => 500,
            _ => 0,
        }
    }

    /// Error code for overlay-error event
    pub fn error_code(&self) -> &'static str {
        match self {
            LlmError::ClientInit { .. } => "llm_init_failed",
            LlmError::Network { .. } => "llm_network_error",
            LlmError::ApiError { status: 429, .. } => "llm_rate_limited",
            LlmError::ApiError { status, .. } if *status == 401 || *status == 403 => {
                "llm_auth_failed"
            }
            LlmError::ApiError { .. } => "llm_api_error",
            LlmError::ParseError { .. } => "llm_parse_error",
            LlmError::AppleIntelligence { .. } => "apple_intelligence_failed",
        }
    }

    /// Human-readable error message
    pub fn message(&self) -> String {
        match self {
            LlmError::ClientInit {
                provider,
                model,
                detail,
                ..
            } => {
                format!("LLM 客户端初始化失败 provider={provider} model={model}: {detail}")
            }
            LlmError::Network {
                provider,
                model,
                url,
                detail,
            } => {
                format!("LLM 网络请求失败 provider={provider} model={model} url={url}: {detail}")
            }
            LlmError::ApiError {
                provider,
                model,
                status,
                body,
            } => {
                format!("LLM 请求失败 provider={provider} model={model} status={status}: {body}")
            }
            LlmError::ParseError {
                provider,
                model,
                detail,
            } => {
                format!("LLM 响应解析失败 provider={provider} model={model}: {detail}")
            }
            LlmError::AppleIntelligence { detail } => {
                format!("Apple Intelligence 请求失败: {detail}")
            }
        }
    }
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

/// Successful LLM response
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LlmResponse {
    pub text: String,
    pub token_count: Option<i64>,
}

/// Result type for LLM calls
#[allow(dead_code)]
pub type LlmResult = Result<LlmResponse, LlmError>;

/// Bridge: convert LlmResult back to the legacy 4-tuple.
/// Use during incremental migration — remove once all callers are migrated.
#[allow(dead_code)]
pub fn llm_result_to_legacy(
    result: LlmResult,
) -> (Option<String>, bool, Option<String>, Option<i64>) {
    match result {
        Ok(resp) => (Some(resp.text), false, None, resp.token_count),
        Err(e) => (None, true, Some(e.message()), None),
    }
}

fn emit_llm_error(app_handle: &AppHandle, error: &LlmError) {
    let _ = app_handle.emit(
        "overlay-error",
        serde_json::json!({
            "code": error.error_code(),
            "message": error.message(),
        }),
    );
}

pub(crate) fn classify_http_status_for_failover(
    status: u16,
    detail: impl Into<String>,
) -> crate::provider_gateway::AttemptError {
    let detail = detail.into();
    match status {
        401 | 403 | 429 => crate::provider_gateway::AttemptError::Retryable {
            status: Some(status),
            detail,
        },
        500..=599 => crate::provider_gateway::AttemptError::Retryable {
            status: Some(status),
            detail,
        },
        _ => crate::provider_gateway::AttemptError::Fatal {
            status: Some(status),
            detail,
        },
    }
}

fn llm_error_to_attempt_error(error: &LlmError) -> crate::provider_gateway::AttemptError {
    match error {
        LlmError::ApiError { status, body, .. } => {
            classify_http_status_for_failover(*status, body.clone())
        }
        LlmError::Network { detail, .. } => crate::provider_gateway::AttemptError::Retryable {
            status: None,
            detail: detail.clone(),
        },
        LlmError::ClientInit { detail, .. }
        | LlmError::ParseError { detail, .. }
        | LlmError::AppleIntelligence { detail } => crate::provider_gateway::AttemptError::Fatal {
            status: None,
            detail: detail.clone(),
        },
    }
}

fn attempt_error_to_llm_error(
    provider_id: String,
    model: &str,
    url: &str,
    error: crate::provider_gateway::AttemptError,
) -> LlmError {
    match error {
        crate::provider_gateway::AttemptError::Retryable {
            status: Some(status),
            detail,
        }
        | crate::provider_gateway::AttemptError::Fatal {
            status: Some(status),
            detail,
        } => LlmError::ApiError {
            provider: provider_id,
            model: model.to_string(),
            status,
            body: detail,
        },
        crate::provider_gateway::AttemptError::Retryable { detail, .. } => LlmError::Network {
            provider: provider_id,
            model: model.to_string(),
            url: url.to_string(),
            detail,
        },
        crate::provider_gateway::AttemptError::Fatal { detail, .. } => LlmError::ClientInit {
            provider: provider_id,
            model: model.to_string(),
            detail,
        },
    }
}

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
    use super::{classify_http_status_for_failover, extract_rewrite_response};
    use crate::provider_gateway::AttemptError;

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

    #[test]
    fn classify_http_status_for_failover_marks_retryable_and_fatal_statuses() {
        assert!(matches!(
            classify_http_status_for_failover(429, "rate limit"),
            AttemptError::Retryable {
                status: Some(429),
                ..
            }
        ));

        assert!(matches!(
            classify_http_status_for_failover(503, "server unavailable"),
            AttemptError::Retryable {
                status: Some(503),
                ..
            }
        ));

        assert!(matches!(
            classify_http_status_for_failover(400, "bad request"),
            AttemptError::Fatal {
                status: Some(400),
                ..
            }
        ));
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

async fn execute_llm_request_inner(
    _app_handle: &AppHandle,
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
) -> LlmResult {
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                return Err(LlmError::AppleIntelligence {
                    detail: "Apple Intelligence 不可用".to_string(),
                });
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
                Ok(result) => Ok(LlmResponse {
                    text: result,
                    token_count: None,
                }),
                Err(err) => Err(LlmError::AppleIntelligence {
                    detail: format!("{}", err),
                }),
            };
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        return Ok(LlmResponse {
            text: String::new(),
            token_count: None,
        });
    }

    // Get key via rotation
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
        return Ok(LlmResponse {
            text: String::new(),
            token_count: None,
        });
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

    let mut base_headers = reqwest::header::HeaderMap::new();
    base_headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    if provider.id == "anthropic" {
        base_headers.insert(
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
                base_headers.insert(name, val);
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
                base_headers.insert(name, val);
            }
        }
    }
    let sanitized_headers: Vec<(String, String)> = base_headers
        .iter()
        .map(|(name, value)| {
            let header_name = name.as_str().to_string();
            let header_value = value.to_str().unwrap_or("<non-utf8>").to_string();
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
    let effective_proxy = crate::settings::resolve_proxy(settings, provider);
    let max_attempts = settings
        .post_process_api_keys
        .get(&provider.id)
        .map(|keys| {
            keys.iter()
                .filter(|entry| entry.enabled && !entry.key.is_empty())
                .count()
                .clamp(1, 3)
        })
        .unwrap_or(1);
    let last_error = Arc::new(Mutex::new(None::<LlmError>));

    let outcome = crate::provider_gateway::execute_with_failover(
        _app_handle,
        settings,
        crate::provider_gateway::ExecutionPlan {
            provider_id: provider.id.clone(),
            cached_model_id: cached_model_id.unwrap_or(model).to_string(),
            remote_model_id: model.to_string(),
            max_attempts,
        },
        {
            let provider = provider.clone();
            let model = model.to_string();
            let url = url.clone();
            let body = body.clone();
            let base_headers = base_headers.clone();
            let effective_proxy = effective_proxy.clone();
            let last_error = Arc::clone(&last_error);

            move |api_key| {
                let api_key = api_key.to_string();
                let provider = provider.clone();
                let model = model.clone();
                let url = url.clone();
                let body = body.clone();
                let mut headers = base_headers.clone();
                let effective_proxy = effective_proxy.clone();
                let last_error = Arc::clone(&last_error);

                async move {
                    match crate::llm_client::create_client(
                        &provider,
                        api_key.clone(),
                        effective_proxy.as_deref(),
                    ) {
                        Ok(_) => {}
                        Err(e) => {
                            let error = LlmError::ClientInit {
                                provider: provider.id.clone(),
                                model: model.clone(),
                                detail: format!("{}", e),
                            };
                            *last_error.lock().unwrap() = Some(error.clone());
                            return Err(llm_error_to_attempt_error(&error));
                        }
                    }

                    headers.insert(
                        reqwest::header::AUTHORIZATION,
                        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key))
                            .unwrap_or_else(|_| reqwest::header::HeaderValue::from_static("")),
                    );

                    let http_client = match crate::http_client::build_http_client(
                        effective_proxy.as_deref(),
                        std::time::Duration::from_secs(60),
                        headers,
                    ) {
                        Ok(client) => client,
                        Err(e) => {
                            let error = LlmError::ClientInit {
                                provider: provider.id.clone(),
                                model: model.clone(),
                                detail: format!("{}", e),
                            };
                            *last_error.lock().unwrap() = Some(error.clone());
                            return Err(llm_error_to_attempt_error(&error));
                        }
                    };

                    match http_client.post(&url).json(&body).send().await {
                        Ok(resp) => {
                            if !resp.status().is_success() {
                                let status = resp.status();
                                let error_text = resp.text().await.unwrap_or_default();
                                let error = LlmError::ApiError {
                                    provider: provider.id.clone(),
                                    model: model.clone(),
                                    status: status.as_u16(),
                                    body: error_text.clone(),
                                };
                                *last_error.lock().unwrap() = Some(error);
                                return Err(classify_http_status_for_failover(
                                    status.as_u16(),
                                    error_text,
                                ));
                            }

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

                                    let raw_content = &json_resp["choices"][0]["message"]["content"];
                                    let content = raw_content
                                        .as_str()
                                        .unwrap_or_default()
                                        .replace('\u{200B}', "")
                                        .replace('\u{200C}', "")
                                        .replace('\u{200D}', "")
                                        .replace('\u{FEFF}', "");

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
                                    Ok(LlmResponse { text, token_count })
                                }
                                Err(e) => {
                                    let error = LlmError::ParseError {
                                        provider: provider.id.clone(),
                                        model: model.clone(),
                                        detail: format!("{:?}", e),
                                    };
                                    *last_error.lock().unwrap() = Some(error.clone());
                                    Err(llm_error_to_attempt_error(&error))
                                }
                            }
                        }
                        Err(err) => {
                            let error = LlmError::Network {
                                provider: provider.id.clone(),
                                model: model.clone(),
                                url: url.clone(),
                                detail: format!("{:?}", err),
                            };
                            *last_error.lock().unwrap() = Some(error.clone());
                            Err(llm_error_to_attempt_error(&error))
                        }
                    }
                }
            }
        },
    )
    .await;

    match outcome {
        crate::provider_gateway::ExecutionOutcome::Success(response) => Ok(response),
        crate::provider_gateway::ExecutionOutcome::Fatal {
            provider_id,
            detail,
        } => Err(last_error
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(LlmError::ClientInit {
                provider: provider_id,
                model: model.to_string(),
                detail,
            })),
        crate::provider_gateway::ExecutionOutcome::Exhausted {
            provider_id,
            last_error: attempt_error,
            ..
        } => Err(last_error.lock().unwrap().clone().unwrap_or_else(|| {
            attempt_error_to_llm_error(provider_id, model, &url, attempt_error)
        })),
    }
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
    let inner_future = execute_llm_request_inner(
        app_handle,
        settings,
        provider,
        model,
        cached_model_id,
        system_prompts,
        user_message,
        conversation_history,
        _app_name,
        _window_title,
        _match_pattern,
        _match_type,
        override_extra_params,
    );

    let result = match tokio::time::timeout(std::time::Duration::from_secs(10), inner_future).await
    {
        Ok(r) => r,
        Err(_) => {
            log::warn!(
                "[LLM] Request timed out (>10s): provider={} model={}",
                provider.id,
                model
            );
            Err(LlmError::Network {
                provider: provider.id.clone(),
                model: model.to_string(),
                url: String::new(),
                detail: "LLM request timed out (>10s)".to_string(),
            })
        }
    };

    if let Err(ref e) = result {
        log::error!("LLM request failed: {}", e);
        emit_llm_error(app_handle, e);
    }

    llm_result_to_legacy(result)
}

/// Typed entry point — returns LlmResult. Caller handles errors.
#[allow(dead_code)]
pub async fn execute_llm_request_typed(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    conversation_history: Option<&[crate::review_window::RewriteMessage]>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> LlmResult {
    execute_llm_request_inner(
        app_handle,
        settings,
        provider,
        model,
        cached_model_id,
        system_prompts,
        user_message,
        conversation_history,
        None,
        None,
        None,
        None,
        override_extra_params,
    )
    .await
}

const MAX_RETRIES: u32 = 2;

/// Execute with automatic retry for transient failures.
/// Total retry budget ≤ 1.5s to keep voice input responsive.
#[allow(dead_code)]
pub async fn execute_llm_request_with_retry(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    conversation_history: Option<&[crate::review_window::RewriteMessage]>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> LlmResult {
    let mut last_error: Option<LlmError> = None;

    for attempt in 0..=MAX_RETRIES {
        let result = execute_llm_request_inner(
            app_handle,
            settings,
            provider,
            model,
            cached_model_id,
            system_prompts,
            user_message,
            conversation_history,
            None,
            None,
            None,
            None,
            override_extra_params,
        )
        .await;

        match result {
            Ok(resp) => return Ok(resp),
            Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                let delay = e.retry_delay_ms(attempt);
                log::warn!(
                    "[LLM] Retryable error on attempt {}/{}: {} (delay={}ms)",
                    attempt + 1,
                    MAX_RETRIES + 1,
                    e,
                    delay,
                );
                if delay > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                }
                last_error = Some(e);
            }
            Err(e) => return Err(e),
        }
    }

    Err(last_error.expect("retry loop must set last_error"))
}
