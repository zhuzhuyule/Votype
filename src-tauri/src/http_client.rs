use log::debug;
use reqwest::header::HeaderMap;
use std::time::Duration;

/// Build a reqwest HTTP client with optional proxy support.
/// All HTTP client creation should go through this function.
pub fn build_http_client(
    proxy_url: Option<&str>,
    timeout: Duration,
    default_headers: HeaderMap,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .default_headers(default_headers)
        .timeout(timeout);

    if let Some(url) = proxy_url {
        if !url.is_empty() {
            debug!("[HttpClient] Using proxy: {}", url);
            let proxy = reqwest::Proxy::all(url)
                .map_err(|e| format!("Invalid proxy URL '{}': {}", url, e))?;
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Build a blocking reqwest HTTP client with optional proxy support.
/// Used for online ASR (which uses reqwest::blocking).
pub fn build_blocking_http_client(
    proxy_url: Option<&str>,
    timeout: Duration,
) -> Result<reqwest::blocking::Client, String> {
    let mut builder = reqwest::blocking::Client::builder().timeout(timeout);

    if let Some(url) = proxy_url {
        if !url.is_empty() {
            debug!("[HttpClient] Using blocking proxy: {}", url);
            let proxy = reqwest::Proxy::all(url)
                .map_err(|e| format!("Invalid proxy URL '{}': {}", url, e))?;
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build blocking HTTP client: {}", e))
}
