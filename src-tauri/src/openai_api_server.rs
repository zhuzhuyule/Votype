use crate::actions::post_process::execute_llm_request_with_messages;
use crate::online_asr::OnlineAsrClient;
use crate::provider_gateway::{AttemptError, AttemptErrorKind, ExecutionOutcome, ExecutionPlan};
use crate::review_window::{RewriteMessage, RewriteRole};
use crate::settings::{self, CachedModel, ModelType, PostProcessProvider};
use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const DEFAULT_API_BIND_HOST: &str = "127.0.0.1";
const DEFAULT_API_BIND_HOST_LAN: &str = "0.0.0.0";
const DEFAULT_API_PORT: u16 = 33178;
const DEFAULT_MAX_FAILOVER_ATTEMPTS: usize = 3;
const DEFAULT_ASR_SAMPLE_RATE: u32 = 16_000;
const DEFAULT_ASR_TIMEOUT_SECS: u64 = 20;
const DEFAULT_API_BASE_PATH: &str = "/v1";

#[derive(Clone)]
struct OpenAiApiState {
    app_handle: AppHandle,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OpenAiModelCard {
    pub id: String,
    pub object: String,
    pub owned_by: String,
    pub model_type: String,
    pub remote_model_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenAiChatRole {
    System,
    Developer,
    User,
    Assistant,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OpenAiContentPart {
    Text { text: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum OpenAiChatContent {
    Text(String),
    Parts(Vec<OpenAiContentPart>),
}

impl OpenAiChatContent {
    fn into_text(self) -> String {
        match self {
            Self::Text(text) => text,
            Self::Parts(parts) => parts
                .into_iter()
                .map(|part| match part {
                    OpenAiContentPart::Text { text } => text,
                })
                .collect::<Vec<_>>()
                .join(""),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpenAiChatMessage {
    pub role: OpenAiChatRole,
    pub content: OpenAiChatContent,
}

#[derive(Debug, Clone)]
pub struct ChatPromptParts {
    pub system_prompts: Vec<String>,
    pub user_message: String,
    pub conversation_history: Vec<RewriteMessage>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<OpenAiChatMessage>,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    temperature: Option<f32>,
    #[serde(default)]
    top_p: Option<f32>,
    #[serde(default)]
    max_tokens: Option<u32>,
    #[serde(default)]
    frequency_penalty: Option<f32>,
    #[serde(default)]
    presence_penalty: Option<f32>,
    #[serde(default)]
    response_format: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct ModelsResponse {
    object: &'static str,
    data: Vec<OpenAiModelCard>,
}

#[derive(Debug, Serialize)]
struct ChatCompletionsResponse {
    id: String,
    object: &'static str,
    created: u64,
    model: String,
    choices: Vec<ChatChoice>,
    usage: ChatUsage,
}

#[derive(Debug, Serialize)]
struct ChatChoice {
    index: u32,
    message: AssistantMessage,
    finish_reason: &'static str,
}

#[derive(Debug, Serialize)]
struct ChatStreamChunk {
    id: String,
    object: &'static str,
    created: u64,
    model: String,
    choices: Vec<ChatStreamChoice>,
}

#[derive(Debug, Serialize)]
struct ChatStreamChoice {
    index: u32,
    delta: ChatStreamDelta,
    finish_reason: Option<&'static str>,
}

#[derive(Debug, Serialize)]
struct ChatStreamDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
}

#[derive(Debug, Serialize)]
struct AssistantMessage {
    role: &'static str,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatUsage {
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
}

#[derive(Debug, Serialize)]
struct TranscriptionResponse {
    text: String,
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    message: String,
    #[serde(rename = "type")]
    error_type: &'static str,
    param: Option<String>,
    code: &'static str,
}

struct ApiError {
    status: StatusCode,
    code: &'static str,
    error_type: &'static str,
    message: String,
    param: Option<String>,
}

impl ApiError {
    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "invalid_api_key",
            error_type: "authentication_error",
            message: "Invalid API key".to_string(),
            param: None,
        }
    }

    fn bad_request(message: impl Into<String>, param: Option<&str>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_request_error",
            error_type: "invalid_request_error",
            message: message.into(),
            param: param.map(|value| value.to_string()),
        }
    }

    fn not_found(message: impl Into<String>, param: Option<&str>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "not_found",
            error_type: "invalid_request_error",
            message: message.into(),
            param: param.map(|value| value.to_string()),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_server_error",
            error_type: "server_error",
            message: message.into(),
            param: None,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorEnvelope {
                error: ErrorBody {
                    message: self.message,
                    error_type: self.error_type,
                    param: self.param,
                    code: self.code,
                },
            }),
        )
            .into_response()
    }
}

pub fn ensure_local_api_settings(app_handle: &AppHandle) {
    let mut settings = settings::get_settings(app_handle);
    let mut changed = false;

    if settings.openai_compatible_api_host.trim().is_empty() {
        settings.openai_compatible_api_host = DEFAULT_API_BIND_HOST.to_string();
        changed = true;
    }

    if settings.openai_compatible_api_port == 0 {
        settings.openai_compatible_api_port = DEFAULT_API_PORT;
        changed = true;
    }

    if settings.openai_compatible_api_access_key.trim().is_empty() {
        settings.openai_compatible_api_access_key = generate_local_api_key(app_handle);
        changed = true;
    }

    let normalized_base_path = normalize_api_base_path(&settings.openai_compatible_api_base_path);
    if settings.openai_compatible_api_base_path != normalized_base_path {
        settings.openai_compatible_api_base_path = normalized_base_path;
        changed = true;
    }

    if changed {
        settings::write_settings(app_handle, settings);
    }
}

pub fn start_openai_api_server(app_handle: &AppHandle) {
    ensure_local_api_settings(app_handle);

    let settings = settings::get_settings(app_handle);
    if !settings.openai_compatible_api_enabled {
        log::info!("[OpenAI API] Local API server disabled in settings");
        return;
    }

    let bind_host = if settings.openai_compatible_api_allow_lan {
        DEFAULT_API_BIND_HOST_LAN.to_string()
    } else if settings.openai_compatible_api_host.trim().is_empty() {
        DEFAULT_API_BIND_HOST.to_string()
    } else {
        settings.openai_compatible_api_host.clone()
    };
    let bind_port = settings.openai_compatible_api_port;
    let api_base_path = normalize_api_base_path(&settings.openai_compatible_api_base_path);
    let state = OpenAiApiState {
        app_handle: app_handle.clone(),
    };

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind((bind_host.as_str(), bind_port)).await {
            Ok(listener) => listener,
            Err(err) => {
                log::error!(
                    "[OpenAI API] Failed to bind local API server on {}:{}: {}",
                    bind_host,
                    bind_port,
                    err
                );
                return;
            }
        };

        let api_router = Router::new()
            .route("/models", get(handle_models))
            .route("/chat/completions", post(handle_chat_completions))
            .route("/audio/transcriptions", post(handle_audio_transcriptions));
        let router = if api_base_path == "/" {
            Router::new().merge(api_router)
        } else {
            Router::new().nest(&api_base_path, api_router)
        }
        .with_state(Arc::new(state));

        log::info!(
            "[OpenAI API] Listening on http://{}:{}{}",
            bind_host,
            bind_port,
            api_base_path
        );

        if let Err(err) = axum::serve(listener, router).await {
            log::error!("[OpenAI API] Server exited with error: {}", err);
        }
    });
}

pub fn build_model_cards(cached_models: &[CachedModel]) -> Vec<OpenAiModelCard> {
    cached_models
        .iter()
        .map(|model| OpenAiModelCard {
            id: model.id.clone(),
            object: "model".to_string(),
            owned_by: model.provider_id.clone(),
            model_type: match model.model_type {
                ModelType::Text => "text",
                ModelType::Asr => "asr",
                ModelType::Other => "other",
            }
            .to_string(),
            remote_model_id: model.model_id.clone(),
            display_name: model
                .custom_label
                .clone()
                .unwrap_or_else(|| model.name.clone()),
        })
        .collect()
}

pub fn split_chat_messages(messages: &[OpenAiChatMessage]) -> Result<ChatPromptParts, String> {
    let mut system_prompts = Vec::new();
    let mut convo_turns = Vec::new();

    for message in messages {
        let content = message.clone().content.into_text();
        if content.trim().is_empty() {
            continue;
        }

        match message.role {
            OpenAiChatRole::System | OpenAiChatRole::Developer => system_prompts.push(content),
            OpenAiChatRole::User => convo_turns.push(RewriteMessage {
                role: RewriteRole::User,
                content,
            }),
            OpenAiChatRole::Assistant => convo_turns.push(RewriteMessage {
                role: RewriteRole::Assistant,
                content,
            }),
        }
    }

    let Some(last_message) = convo_turns.pop() else {
        return Err("messages must include at least one user message".to_string());
    };

    if !matches!(last_message.role, RewriteRole::User) {
        return Err("the last message must be a user message".to_string());
    }

    Ok(ChatPromptParts {
        system_prompts,
        user_message: last_message.content,
        conversation_history: convo_turns,
    })
}

fn build_chat_override_params(
    payload: &ChatCompletionsRequest,
) -> Option<HashMap<String, serde_json::Value>> {
    let mut params = HashMap::new();

    if let Some(value) = payload.temperature {
        params.insert("temperature".to_string(), json!(value));
    }
    if let Some(value) = payload.top_p {
        params.insert("top_p".to_string(), json!(value));
    }
    if let Some(value) = payload.max_tokens {
        params.insert("max_tokens".to_string(), json!(value));
    }
    if let Some(value) = payload.frequency_penalty {
        params.insert("frequency_penalty".to_string(), json!(value));
    }
    if let Some(value) = payload.presence_penalty {
        params.insert("presence_penalty".to_string(), json!(value));
    }
    if let Some(value) = payload.response_format.clone() {
        params.insert("response_format".to_string(), value);
    }

    (!params.is_empty()).then_some(params)
}

async fn handle_models(
    State(state): State<Arc<OpenAiApiState>>,
    headers: HeaderMap,
) -> Result<Json<ModelsResponse>, ApiError> {
    authorize_request(&state, &headers)?;

    let settings = settings::get_settings(&state.app_handle);
    Ok(Json(ModelsResponse {
        object: "list",
        data: build_model_cards(&settings.cached_models),
    }))
}

async fn handle_chat_completions(
    State(state): State<Arc<OpenAiApiState>>,
    headers: HeaderMap,
    Json(payload): Json<ChatCompletionsRequest>,
) -> Result<Response, ApiError> {
    authorize_request(&state, &headers)?;

    let settings = settings::get_settings(&state.app_handle);
    let cached_model = resolve_cached_model(&settings, &payload.model, ModelType::Text)?;
    let provider = resolve_provider(&settings, &cached_model.provider_id)?;
    let prompt_parts =
        split_chat_messages(&payload.messages).map_err(|err| ApiError::bad_request(err, None))?;
    let conversation_history = (!prompt_parts.conversation_history.is_empty())
        .then_some(prompt_parts.conversation_history.as_slice());
    let override_params = build_chat_override_params(&payload);

    let (text, error, error_message, token_count) = execute_llm_request_with_messages(
        &state.app_handle,
        &settings,
        provider,
        &cached_model.model_id,
        Some(&cached_model.id),
        &prompt_parts.system_prompts,
        Some(prompt_parts.user_message.as_str()),
        conversation_history,
        None,
        None,
        None,
        None,
        override_params.as_ref(),
    )
    .await;

    if error {
        return Err(ApiError::internal(
            error_message.unwrap_or_else(|| "chat completion failed".to_string()),
        ));
    }

    let content = text.ok_or_else(|| ApiError::internal("chat completion returned empty text"))?;
    let completion_tokens = token_count.unwrap_or(0);
    let completion_id = format!("chatcmpl-{}", current_timestamp_secs());
    let created = current_timestamp_secs();

    if payload.stream {
        return Ok(build_streaming_chat_response(
            &completion_id,
            created,
            &cached_model.id,
            &content,
        ));
    }

    Ok(Json(ChatCompletionsResponse {
        id: completion_id,
        object: "chat.completion",
        created,
        model: cached_model.id.clone(),
        choices: vec![ChatChoice {
            index: 0,
            message: AssistantMessage {
                role: "assistant",
                content,
            },
            finish_reason: "stop",
        }],
        usage: ChatUsage {
            prompt_tokens: 0,
            completion_tokens,
            total_tokens: completion_tokens,
        },
    })
    .into_response())
}

async fn handle_audio_transcriptions(
    State(state): State<Arc<OpenAiApiState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<TranscriptionResponse>, ApiError> {
    authorize_request(&state, &headers)?;

    let mut model: Option<String> = None;
    let mut language: Option<String> = None;
    let mut file_name: Option<String> = None;
    let mut mime_type: Option<String> = None;
    let mut audio_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| ApiError::bad_request(format!("invalid multipart body: {}", err), None))?
    {
        let field_name = field.name().unwrap_or_default().to_string();
        match field_name.as_str() {
            "model" => {
                model = Some(field.text().await.map_err(|err| {
                    ApiError::bad_request(format!("failed to read model field: {}", err), None)
                })?);
            }
            "language" => {
                language = Some(field.text().await.map_err(|err| {
                    ApiError::bad_request(format!("failed to read language field: {}", err), None)
                })?);
            }
            "file" => {
                file_name = field.file_name().map(|value| value.to_string());
                mime_type = field.content_type().map(|value| value.to_string());
                audio_bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|err| {
                            ApiError::bad_request(
                                format!("failed to read audio file: {}", err),
                                Some("file"),
                            )
                        })?
                        .to_vec(),
                );
            }
            _ => {}
        }
    }

    let model = model.ok_or_else(|| ApiError::bad_request("missing model field", Some("model")))?;
    let audio_bytes =
        audio_bytes.ok_or_else(|| ApiError::bad_request("missing file field", Some("file")))?;

    let settings = settings::get_settings(&state.app_handle);
    let cached_model = resolve_cached_model(&settings, &model, ModelType::Asr)?;
    let provider = resolve_provider(&settings, &cached_model.provider_id)?.clone();
    let app_handle = state.app_handle.clone();
    let cached_model_id = cached_model.id.clone();
    let remote_model_id = cached_model.model_id.clone();
    let file_name = file_name.unwrap_or_else(|| "audio.bin".to_string());
    let mime_type = mime_type.unwrap_or_else(|| "application/octet-stream".to_string());
    let language = language.filter(|value| !value.trim().is_empty());

    let outcome = crate::provider_gateway::execute_with_failover(
        &app_handle,
        &settings,
        ExecutionPlan {
            provider_id: provider.id.clone(),
            cached_model_id,
            remote_model_id: remote_model_id.clone(),
            max_attempts: DEFAULT_MAX_FAILOVER_ATTEMPTS,
        },
        move |api_key| {
            let provider = provider.clone();
            let remote_model_id = remote_model_id.clone();
            let language = language.clone();
            let audio_bytes = audio_bytes.clone();
            let file_name = file_name.clone();
            let mime_type = mime_type.clone();
            let api_key = api_key.to_string();

            async move {
                tokio::task::spawn_blocking(move || {
                    let client = OnlineAsrClient::new(
                        DEFAULT_ASR_SAMPLE_RATE,
                        Duration::from_secs(DEFAULT_ASR_TIMEOUT_SECS),
                    );

                    client.transcribe_audio_bytes(
                        &provider,
                        Some(api_key),
                        &remote_model_id,
                        language.as_deref(),
                        &audio_bytes,
                        Some(file_name.as_str()),
                        Some(mime_type.as_str()),
                    )
                })
                .await
                .map_err(|err| AttemptError::Retryable {
                    status: None,
                    detail: format!("ASR worker join failed: {}", err),
                    kind: AttemptErrorKind::Other,
                })?
                .map_err(|err| classify_online_asr_attempt_error(&err.to_string()))
            }
        },
    )
    .await;

    let text = match outcome {
        ExecutionOutcome::Success(text) => text,
        ExecutionOutcome::Fatal { detail, .. } => return Err(ApiError::internal(detail)),
        ExecutionOutcome::Exhausted { last_error, .. } => {
            return Err(ApiError::internal(match last_error {
                AttemptError::Retryable { detail, .. } | AttemptError::Fatal { detail, .. } => {
                    detail
                }
            }))
        }
    };

    Ok(Json(TranscriptionResponse { text }))
}

fn authorize_request(state: &OpenAiApiState, headers: &HeaderMap) -> Result<(), ApiError> {
    let settings = settings::get_settings(&state.app_handle);
    if !settings.openai_compatible_api_enabled {
        return Err(ApiError {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "service_disabled",
            error_type: "server_error",
            message: "Local OpenAI-compatible API is disabled".to_string(),
            param: None,
        });
    }

    let expected_key = settings.openai_compatible_api_access_key.trim();
    if expected_key.is_empty() {
        return Err(ApiError::unauthorized());
    }

    let supplied_key = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get("x-api-key")
                .and_then(|value| value.to_str().ok())
        })
        .map(str::trim)
        .unwrap_or_default();

    if supplied_key == expected_key {
        Ok(())
    } else {
        Err(ApiError::unauthorized())
    }
}

fn resolve_cached_model<'a>(
    settings: &'a settings::AppSettings,
    model_id: &str,
    expected_type: ModelType,
) -> Result<&'a CachedModel, ApiError> {
    let cached_model = settings.get_cached_model(model_id).ok_or_else(|| {
        ApiError::not_found(format!("model '{}' was not found", model_id), Some("model"))
    })?;

    if cached_model.model_type != expected_type {
        return Err(ApiError::bad_request(
            format!(
                "model '{}' is not available for {} requests",
                model_id,
                match expected_type {
                    ModelType::Text => "chat",
                    ModelType::Asr => "transcription",
                    ModelType::Other => "this",
                }
            ),
            Some("model"),
        ));
    }

    Ok(cached_model)
}

fn resolve_provider<'a>(
    settings: &'a settings::AppSettings,
    provider_id: &str,
) -> Result<&'a PostProcessProvider, ApiError> {
    settings
        .post_process_providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| {
            ApiError::not_found(
                format!("provider '{}' was not found", provider_id),
                Some("model"),
            )
        })
}

fn classify_online_asr_attempt_error(detail: &str) -> AttemptError {
    if let Some(status) = extract_status_code(detail) {
        return match status {
            401 | 403 => AttemptError::Fatal {
                status: Some(status),
                detail: detail.to_string(),
                kind: AttemptErrorKind::Http,
            },
            429 | 500..=599 => AttemptError::Retryable {
                status: Some(status),
                detail: detail.to_string(),
                kind: AttemptErrorKind::Http,
            },
            _ => AttemptError::Fatal {
                status: Some(status),
                detail: detail.to_string(),
                kind: AttemptErrorKind::Http,
            },
        };
    }

    let lower = detail.to_lowercase();
    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection")
        || lower.contains("dns")
    {
        return AttemptError::Retryable {
            status: None,
            detail: detail.to_string(),
            kind: AttemptErrorKind::Network,
        };
    }

    if lower.contains("deserialize") || lower.contains("missing text field") {
        return AttemptError::Fatal {
            status: None,
            detail: detail.to_string(),
            kind: AttemptErrorKind::Parse,
        };
    }

    AttemptError::Retryable {
        status: None,
        detail: detail.to_string(),
        kind: AttemptErrorKind::Other,
    }
}

fn extract_status_code(detail: &str) -> Option<u16> {
    detail
        .split(|ch: char| !ch.is_ascii_digit())
        .find_map(|token| match token.len() {
            3 => token.parse::<u16>().ok(),
            _ => None,
        })
}

fn generate_local_api_key(app_handle: &AppHandle) -> String {
    let now = current_timestamp_secs();
    let mut hasher = Sha256::new();
    hasher.update(app_handle.package_info().name.as_bytes());
    hasher.update(app_handle.package_info().version.to_string().as_bytes());
    hasher.update(std::process::id().to_string().as_bytes());
    hasher.update(now.to_string().as_bytes());
    let digest = hasher.finalize();
    format!("votype-local-{:x}", digest)[..29].to_string()
}

fn current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn normalize_api_base_path(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return DEFAULT_API_BASE_PATH.to_string();
    }

    let mut normalized = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{}", trimmed)
    };

    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }

    normalized
}

fn build_streaming_chat_response(
    completion_id: &str,
    created: u64,
    model: &str,
    content: &str,
) -> Response {
    let first_chunk = ChatStreamChunk {
        id: completion_id.to_string(),
        object: "chat.completion.chunk",
        created,
        model: model.to_string(),
        choices: vec![ChatStreamChoice {
            index: 0,
            delta: ChatStreamDelta {
                role: Some("assistant"),
                content: Some(content.to_string()),
            },
            finish_reason: None,
        }],
    };
    let final_chunk = ChatStreamChunk {
        id: completion_id.to_string(),
        object: "chat.completion.chunk",
        created,
        model: model.to_string(),
        choices: vec![ChatStreamChoice {
            index: 0,
            delta: ChatStreamDelta {
                role: None,
                content: None,
            },
            finish_reason: Some("stop"),
        }],
    };

    let body = format!(
        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
        serde_json::to_string(&first_chunk).unwrap_or_else(|_| "{}".to_string()),
        serde_json::to_string(&final_chunk).unwrap_or_else(|_| "{}".to_string()),
    );

    let mut response = body.into_response();
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );
    response.headers_mut().insert(
        axum::http::header::CONNECTION,
        HeaderValue::from_static("keep-alive"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::{
        build_chat_override_params, build_model_cards, build_streaming_chat_response,
        normalize_api_base_path, split_chat_messages, ChatCompletionsRequest, OpenAiChatContent,
        OpenAiChatMessage, OpenAiChatRole, OpenAiModelCard,
    };
    use crate::review_window::RewriteRole;
    use crate::settings::{CachedModel, ModelType, PromptMessageRole};
    use axum::body::to_bytes;
    use serde_json::json;

    fn cached_model(
        id: &str,
        provider_id: &str,
        model_id: &str,
        model_type: ModelType,
    ) -> CachedModel {
        CachedModel {
            id: id.to_string(),
            name: format!("name-{id}"),
            model_type,
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            added_at: "2026-04-14T00:00:00Z".to_string(),
            custom_label: Some(format!("label-{id}")),
            is_thinking_model: false,
            model_family: None,
            prompt_message_role: PromptMessageRole::System,
            extra_params: None,
            extra_headers: None,
        }
    }

    #[test]
    fn model_cards_use_cached_model_ids() {
        let cards = build_model_cards(&[
            cached_model("cm-text", "provider-a", "gpt-4.1-mini", ModelType::Text),
            cached_model("cm-asr", "provider-b", "whisper-1", ModelType::Asr),
        ]);

        assert_eq!(
            cards,
            vec![
                OpenAiModelCard {
                    id: "cm-text".to_string(),
                    object: "model".to_string(),
                    owned_by: "provider-a".to_string(),
                    model_type: "text".to_string(),
                    remote_model_id: "gpt-4.1-mini".to_string(),
                    display_name: "label-cm-text".to_string(),
                },
                OpenAiModelCard {
                    id: "cm-asr".to_string(),
                    object: "model".to_string(),
                    owned_by: "provider-b".to_string(),
                    model_type: "asr".to_string(),
                    remote_model_id: "whisper-1".to_string(),
                    display_name: "label-cm-asr".to_string(),
                },
            ]
        );
    }

    #[test]
    fn chat_messages_split_into_system_history_and_latest_user_prompt() {
        let parts = split_chat_messages(&[
            OpenAiChatMessage {
                role: OpenAiChatRole::System,
                content: OpenAiChatContent::Text("你是助手".to_string()),
            },
            OpenAiChatMessage {
                role: OpenAiChatRole::Developer,
                content: OpenAiChatContent::Text("保持简洁".to_string()),
            },
            OpenAiChatMessage {
                role: OpenAiChatRole::User,
                content: OpenAiChatContent::Text("第一问".to_string()),
            },
            OpenAiChatMessage {
                role: OpenAiChatRole::Assistant,
                content: OpenAiChatContent::Text("第一答".to_string()),
            },
            OpenAiChatMessage {
                role: OpenAiChatRole::User,
                content: OpenAiChatContent::Text("第二问".to_string()),
            },
        ])
        .expect("messages should split");

        assert_eq!(
            parts.system_prompts,
            vec!["你是助手".to_string(), "保持简洁".to_string()]
        );
        assert_eq!(parts.user_message, "第二问");
        assert_eq!(
            parts
                .conversation_history
                .iter()
                .map(|msg| match msg.role {
                    RewriteRole::User => ("user", msg.content.as_str()),
                    RewriteRole::Assistant => ("assistant", msg.content.as_str()),
                })
                .collect::<Vec<_>>(),
            vec![("user", "第一问"), ("assistant", "第一答")]
        );
    }

    #[tokio::test]
    async fn streaming_response_contains_done_marker_and_chunk_payloads() {
        let response = build_streaming_chat_response("chatcmpl-test", 123, "cm-text", "最终结果");
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should be readable");
        let text = String::from_utf8(body.to_vec()).expect("body should be utf8");

        assert!(text.contains("\"object\":\"chat.completion.chunk\""));
        assert!(text.contains("\"content\":\"最终结果\""));
        assert!(text.contains("data: [DONE]"));
    }

    #[tokio::test]
    async fn streaming_response_sets_event_stream_content_type() {
        let response = build_streaming_chat_response("chatcmpl-test", 123, "cm-text", "ok");
        let content_type = response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok());

        assert_eq!(content_type, Some("text/event-stream; charset=utf-8"));
    }

    #[test]
    fn api_base_path_normalization_adds_prefix_and_trims_suffix() {
        assert_eq!(normalize_api_base_path(""), "/v1");
        assert_eq!(normalize_api_base_path("v1"), "/v1");
        assert_eq!(normalize_api_base_path("/custom/api/"), "/custom/api");
    }

    #[test]
    fn chat_override_params_collect_supported_openai_fields() {
        let payload = ChatCompletionsRequest {
            model: "cm-text".to_string(),
            messages: vec![],
            stream: false,
            temperature: Some(0.2),
            top_p: Some(0.9),
            max_tokens: Some(512),
            frequency_penalty: Some(0.3),
            presence_penalty: Some(0.4),
            response_format: Some(json!({"type":"json_object"})),
        };

        let params = build_chat_override_params(&payload).expect("params should exist");
        let temperature = params
            .get("temperature")
            .and_then(|value| value.as_f64())
            .expect("temperature should be numeric");
        let top_p = params
            .get("top_p")
            .and_then(|value| value.as_f64())
            .expect("top_p should be numeric");
        let frequency_penalty = params
            .get("frequency_penalty")
            .and_then(|value| value.as_f64())
            .expect("frequency_penalty should be numeric");
        let presence_penalty = params
            .get("presence_penalty")
            .and_then(|value| value.as_f64())
            .expect("presence_penalty should be numeric");

        assert!((temperature - 0.2).abs() < 1e-6);
        assert!((top_p - 0.9).abs() < 1e-6);
        assert_eq!(params.get("max_tokens"), Some(&json!(512)));
        assert!((frequency_penalty - 0.3).abs() < 1e-6);
        assert!((presence_penalty - 0.4).abs() < 1e-6);
        assert_eq!(
            params.get("response_format"),
            Some(&json!({"type":"json_object"}))
        );
    }
}
