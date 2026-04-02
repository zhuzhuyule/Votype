use crate::settings::PostProcessProvider;
use async_openai::{config::OpenAIConfig, Client};
use log::{debug, info, warn};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Create an OpenAI-compatible client configured for the given provider (async_openai version)
pub fn create_client(
    provider: &PostProcessProvider,
    api_key: String,
    proxy_url: Option<&str>,
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

    let http_client = crate::http_client::build_http_client(
        proxy_url,
        std::time::Duration::from_secs(30),
        headers,
    )?;

    let client = Client::with_config(config).with_http_client(http_client);

    Ok(client)
}

/// Fetch available models from an OpenAI-compatible API
pub async fn fetch_models(
    provider: &PostProcessProvider,
    api_key: String,
    proxy_url: Option<&str>,
) -> Result<Vec<String>, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let endpoint = provider.models_endpoint.as_deref().unwrap_or("/models");
    let url = if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        endpoint.to_string()
    } else if endpoint.starts_with('/') {
        format!("{}{}", base_url, endpoint)
    } else {
        format!("{}/{}", base_url, endpoint)
    };

    debug!("[FetchModels] {} (provider={})", url, provider.id);

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

    let client = crate::http_client::build_http_client(
        proxy_url,
        std::time::Duration::from_secs(30),
        headers,
    )?;

    let response = client.get(&url).send().await.map_err(|e| {
        warn!("[FetchModels] Request failed: {}", e);
        format!("Failed to fetch models: {}", e)
    })?;

    let status = response.status();

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        warn!("[FetchModels] Error ({}): {}", status, error_text);
        return Err(format!(
            "Model list request failed ({}): {}",
            status, error_text
        ));
    }

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

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

    info!("[FetchModels] Found {} models", models.len());

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
    pub duration_ms: Option<i64>,
    pub total_tokens: Option<i64>,
}

#[allow(dead_code)]
pub async fn send_chat_completion(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    prompt: String,
    proxy_url: Option<&str>,
) -> Result<InferenceResult, String> {
    send_chat_completion_with_params(provider, api_key, model, prompt, None, None, proxy_url).await
}

pub async fn send_chat_completion_with_params(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    prompt: String,
    extra_params: Option<&std::collections::HashMap<String, serde_json::Value>>,
    extra_headers: Option<&std::collections::HashMap<String, String>>,
    proxy_url: Option<&str>,
) -> Result<InferenceResult, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    info!("[TestInference] >>> {} model={}", url, model);

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
    // Apply provider-level custom headers
    if let Some(custom) = &provider.custom_headers {
        for (k, v) in custom {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(v),
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
                HeaderValue::from_str(v),
            ) {
                headers.insert(name, val);
            }
        }
    }

    // Detect thinking model from extra_params to set appropriate timeout
    let is_thinking = extra_params.map_or(false, |p| {
        p.contains_key("thinking")
            || p.contains_key("reasoning_effort")
            || p.get("chat_template_kwargs")
                .and_then(|v| v.get("enable_thinking"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            || p.get("enable_thinking")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
    });
    let timeout_secs = if is_thinking { 120 } else { 30 };

    let client = crate::http_client::build_http_client(
        proxy_url,
        std::time::Duration::from_secs(timeout_secs),
        headers,
    )?;

    let mut body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": prompt,
        }],
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
        "[TestInference] Request body:\n{}",
        serde_json::to_string_pretty(&body).unwrap_or_else(|_| body.to_string())
    );

    let request_start = std::time::Instant::now();

    let response = client.post(&url).json(&body).send().await.map_err(|e| {
        warn!("[TestInference] Request failed: {}", e);
        format!("HTTP request failed: {}", e)
    })?;

    let status = response.status();

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        warn!("[ChatCompletion] Error ({}): {}", status, body_text);
        return Err(format!(
            "API request failed with status {}: {}",
            status, body_text
        ));
    }

    // Parse response as raw JSON first to detect thinking fields
    let raw_response: serde_json::Value = serde_json::from_str(&body_text).map_err(|e| {
        warn!("[ChatCompletion] Failed to parse JSON: {}", e);
        format!("Failed to parse API response: {}", e)
    })?;

    // Detect thinking content from the raw response (different providers use different field names)
    let first_choice = raw_response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first());
    let message = first_choice.and_then(|c| c.get("message"));

    let content = message
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Check multiple possible thinking field names across providers
    let reasoning_content = message
        .and_then(|m| {
            m.get("reasoning_content") // DeepSeek, OpenAI-compatible
                .or_else(|| m.get("reasoning")) // Some providers
                .or_else(|| m.get("thinking")) // Alternative naming
        })
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Also detect <think> tags embedded in content
    let has_think_tags = content
        .as_ref()
        .map(|c| c.contains("<think>") || c.contains("</think>"))
        .unwrap_or(false);

    let has_thinking = reasoning_content.is_some() || has_think_tags;
    let elapsed = request_start.elapsed();

    let content_len = content.as_ref().map(|s| s.len()).unwrap_or(0);
    let reasoning_len = reasoning_content.as_ref().map(|s| s.len()).unwrap_or(0);
    info!(
        "[TestInference] <<< model={} elapsed={:.1}s content_len={} thinking={} reasoning_len={}",
        model,
        elapsed.as_secs_f64(),
        content_len,
        has_thinking,
        reasoning_len
    );
    info!(
        "[TestInference] Response body:\n{}",
        serde_json::to_string_pretty(&raw_response).unwrap_or_else(|_| body_text.clone())
    );

    let usage = raw_response.get("usage");
    let total_tokens = usage
        .and_then(|u| u.get("total_tokens"))
        .and_then(|v| v.as_i64());

    // Strip <think>...</think> tags from content if present
    let content = content.map(|c| {
        let mut text = c;
        while let Some(start) = text.find("<think>") {
            if let Some(end) = text[start..].find("</think>") {
                text.replace_range(start..start + end + 8, "");
            } else {
                break;
            }
        }
        text.trim().to_string()
    });

    let result = InferenceResult {
        content,
        reasoning_content,
        duration_ms: Some(elapsed.as_millis() as i64),
        total_tokens,
    };

    Ok(result)
}
