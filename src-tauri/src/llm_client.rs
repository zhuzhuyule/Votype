use crate::settings::PostProcessProvider;
use async_openai::{config::OpenAIConfig, Client};

/// Create an OpenAI-compatible client configured for the given provider
pub fn create_client(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Client<OpenAIConfig>, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let config = OpenAIConfig::new()
        .with_api_base(base_url)
        .with_api_key(api_key);

    // Create client with custom timeout and headers
    let mut headers = reqwest::header::HeaderMap::new();
    if provider.id == "anthropic" {
        headers.insert(
            "anthropic-version",
            reqwest::header::HeaderValue::from_static("2023-06-01"),
        );
    }

    let http_client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let client = Client::with_config(config).with_http_client(http_client);

    Ok(client)
}
