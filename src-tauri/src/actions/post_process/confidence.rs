use crate::managers::prompt::{self, PromptManager};
use crate::settings::PostProcessProvider;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
};
use log::{info, warn};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// Response from LLM confidence check
#[derive(Debug, Deserialize)]
pub struct ConfidenceCheckResponse {
    pub confidence: u8,
    pub reason: Option<String>,
}

/// Perform confidence check: call lightweight LLM to evaluate polish quality.
/// Returns None if the check fails or is unavailable.
pub async fn perform_confidence_check(
    app_handle: &AppHandle,
    provider: &PostProcessProvider,
    model: &str,
    api_key: String,
    source_text: &str,
    polished_text: &str,
) -> Option<ConfidenceCheckResponse> {
    info!(
        "[ConfidenceCheck] Starting check: model={}, source_len={}, polished_len={}",
        model,
        source_text.len(),
        polished_text.len()
    );

    let prompt_manager = app_handle.state::<Arc<PromptManager>>();
    let template = match prompt_manager.get_prompt(app_handle, "system_confidence_check") {
        Ok(t) => t,
        Err(e) => {
            warn!("[ConfidenceCheck] Failed to load prompt template: {}", e);
            return None;
        }
    };

    // Substitute variables
    let mut vars = std::collections::HashMap::new();
    vars.insert("source_text", source_text.to_string());
    vars.insert("target_text", polished_text.to_string());
    let system_prompt = prompt::substitute_variables(&template, &vars);

    let client = match crate::llm_client::create_client(provider, api_key) {
        Ok(c) => c,
        Err(e) => {
            warn!("[ConfidenceCheck] Failed to create LLM client: {:?}", e);
            return None;
        }
    };

    let mut messages = Vec::new();

    if let Ok(sys_msg) = ChatCompletionRequestSystemMessageArgs::default()
        .content(system_prompt)
        .build()
    {
        messages.push(ChatCompletionRequestMessage::System(sys_msg));
    }

    if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content("请评估上述润色结果的质量。")
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(user_msg));
    }

    let req = match CreateChatCompletionRequestArgs::default()
        .model(model.to_string())
        .messages(messages)
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            warn!("[ConfidenceCheck] Failed to build request: {:?}", e);
            return None;
        }
    };

    let response = match client.chat().create(req).await {
        Ok(r) => r,
        Err(e) => {
            warn!("[ConfidenceCheck] LLM request failed: {:?}", e);
            return None;
        }
    };

    let content = match response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
    {
        Some(c) => c,
        None => {
            warn!("[ConfidenceCheck] LLM response has no content");
            return None;
        }
    };

    info!("[ConfidenceCheck] Raw LLM response: {}", content);

    // Parse JSON response
    let cleaned = super::core::clean_response_content(&content);
    let json_str = super::core::extract_json_block(&cleaned).unwrap_or_else(|| cleaned.clone());

    match serde_json::from_str::<ConfidenceCheckResponse>(&json_str) {
        Ok(result) => {
            info!(
                "[ConfidenceCheck] Result: confidence={}, reason={:?}",
                result.confidence, result.reason
            );
            Some(result)
        }
        Err(e) => {
            warn!(
                "[ConfidenceCheck] Failed to parse response: {} (raw: {})",
                e, json_str
            );
            None
        }
    }
}
