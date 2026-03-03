use crate::settings::PostProcessProvider;
use async_openai::{config::OpenAIConfig, Client};
use log::debug;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Create an OpenAI-compatible client configured for the given provider (async_openai version)
pub fn create_client(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Client<OpenAIConfig>, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let config = OpenAIConfig::new()
        .with_api_base(base_url)
        .with_api_key(api_key);

    // Create client with custom timeout and headers
    let mut headers = HeaderMap::new();
    if provider.id == "anthropic" {
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    }

    let http_client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let client = Client::with_config(config).with_http_client(http_client);

    Ok(client)
}

/// Fetch available models from an OpenAI-compatible API
pub async fn fetch_models(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Vec<String>, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let endpoint = provider.models_endpoint.as_deref().unwrap_or("/models");
    let url = if endpoint.starts_with('/') {
        format!("{}{}", base_url, endpoint)
    } else {
        format!("{}/{}", base_url, endpoint)
    };

    println!("[FETCH_MODELS] Starting request to: {}", url);
    debug!("Fetching models from: {}", url);

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if !api_key.is_empty() {
        if provider.id == "anthropic" {
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
            );
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        } else {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", api_key)).map_err(|e| e.to_string())?,
            );
        }
    }

    let mut log_headers = headers.clone();
    if log_headers.contains_key(AUTHORIZATION) {
        log_headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer [REDACTED]"));
    }
    if log_headers.contains_key("x-api-key") {
        log_headers.insert("x-api-key", HeaderValue::from_static("[REDACTED]"));
    }
    println!("[FETCH_MODELS] Request headers: {:?}", log_headers);

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client.get(&url).send().await.map_err(|e| {
        println!("[FETCH_MODELS] Request failed: {}", e);
        format!("Failed to fetch models: {}", e)
    })?;

    let status = response.status();
    println!("[FETCH_MODELS] Response status: {}", status);

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        println!("[FETCH_MODELS] Error response body: {}", error_text);
        return Err(format!(
            "Model list request failed ({}): {}",
            status, error_text
        ));
    }

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    println!("[FETCH_MODELS] Success response body: {}", body_text);

    let parsed: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

    let mut models = Vec::new();

    if let Some(data) = parsed.get("data").and_then(|d| d.as_array()) {
        for entry in data {
            if let Some(id) = entry.get("id").and_then(|i| i.as_str()) {
                models.push(id.to_string());
            }
        }
    } else if let Some(array) = parsed.as_array() {
        for entry in array {
            if let Some(model) = entry.as_str() {
                models.push(model.to_string());
            }
        }
    }

    println!("[FETCH_MODELS] Found {} models", models.len());

    Ok(models)
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatChoiceMessage {
    content: Option<String>,
    reasoning_content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatMessageResponse {
    content: Option<String>,
    reasoning_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct InferenceResult {
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
}

#[allow(dead_code)]
pub async fn send_chat_completion(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    prompt: String,
) -> Result<InferenceResult, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    println!("[CHAT_COMPLETION] Starting request to: {}", url);

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if !api_key.is_empty() {
        if provider.id == "anthropic" {
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
            );
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        } else {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", api_key)).map_err(|e| e.to_string())?,
            );
        }
    }

    let mut log_headers = headers.clone();
    if log_headers.contains_key(AUTHORIZATION) {
        log_headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer [REDACTED]"));
    }
    if log_headers.contains_key("x-api-key") {
        log_headers.insert("x-api-key", HeaderValue::from_static("[REDACTED]"));
    }
    println!("[CHAT_COMPLETION] Request headers: {:?}", log_headers);

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let request_body = ChatCompletionRequest {
        model: model.to_string(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }],
    };

    println!(
        "[CHAT_COMPLETION] Request body: {}",
        serde_json::to_string(&request_body).unwrap_or_default()
    );

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            println!("[CHAT_COMPLETION] Request failed: {}", e);
            format!("HTTP request failed: {}", e)
        })?;

    let status = response.status();
    println!("[CHAT_COMPLETION] Response status: {}", status);

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        println!("[CHAT_COMPLETION] Error response body: {}", body_text);
        return Err(format!(
            "API request failed with status {}: {}",
            status, body_text
        ));
    }

    println!("[CHAT_COMPLETION] Success response body: {}", body_text);

    let completion: ChatCompletionResponse = serde_json::from_str(&body_text).map_err(|e| {
        println!("[CHAT_COMPLETION] Failed to parse JSON: {}", e);
        format!("Failed to parse API response: {}", e)
    })?;

    Ok(completion
        .choices
        .first()
        .map(|choice| InferenceResult {
            content: choice.message.content.clone(),
            reasoning_content: choice.message.reasoning_content.clone(),
        })
        .unwrap_or(InferenceResult {
            content: None,
            reasoning_content: None,
        }))
}
