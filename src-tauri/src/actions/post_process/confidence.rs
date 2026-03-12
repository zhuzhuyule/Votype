use crate::managers::prompt::{self, PromptManager};
use crate::settings::PostProcessProvider;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
};
use log::{info, warn};
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// A single word-level change detected by the confidence check
#[derive(Debug, Clone, Deserialize)]
pub struct WordChange {
    pub original: String,
    pub corrected: String,
    #[serde(default)]
    pub is_hotword: bool,
    pub category: Option<String>,
}

/// Response from LLM confidence check
#[derive(Debug, Deserialize)]
pub struct ConfidenceCheckResponse {
    pub confidence: u8,
    #[serde(default)]
    pub changes: Vec<WordChange>,
}

impl ConfidenceCheckResponse {
    pub fn retain_meaningful_changes(&mut self) {
        let mut seen = HashSet::new();
        self.changes.retain(|change| {
            let original = change.original.trim();
            let corrected = change.corrected.trim();
            if original.is_empty() || corrected.is_empty() || original == corrected {
                return false;
            }

            seen.insert(format!("{}\u{241f}{}", original, corrected))
        });
    }

    /// Format changes into a human-readable reason string for display
    pub fn format_reason(&self) -> Option<String> {
        if self.changes.is_empty() {
            return None;
        }
        let parts: Vec<String> = self
            .changes
            .iter()
            .map(|c| {
                if c.is_hotword {
                    format!("{} → {} ✓", c.original, c.corrected)
                } else {
                    format!("{} → {}", c.original, c.corrected)
                }
            })
            .collect();
        Some(parts.join("  "))
    }
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
        .content("请评估上述润色结果的质量，并列出所有词级变动。")
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
        Ok(mut result) => {
            result.retain_meaningful_changes();
            info!(
                "[ConfidenceCheck] Result: confidence={}, changes={}",
                result.confidence,
                result.changes.len()
            );
            for c in &result.changes {
                info!(
                    "[ConfidenceCheck]   {} → {} (hotword={}, category={:?})",
                    c.original, c.corrected, c.is_hotword, c.category
                );
            }
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

#[cfg(test)]
mod tests {
    use super::{ConfidenceCheckResponse, WordChange};

    #[test]
    fn retain_meaningful_changes_filters_unchanged_and_duplicates() {
        let mut result = ConfidenceCheckResponse {
            confidence: 90,
            changes: vec![
                WordChange {
                    original: "提示词".into(),
                    corrected: "提示词".into(),
                    is_hotword: false,
                    category: None,
                },
                WordChange {
                    original: "你".into(),
                    corrected: "我们".into(),
                    is_hotword: false,
                    category: None,
                },
                WordChange {
                    original: "你".into(),
                    corrected: "我们".into(),
                    is_hotword: false,
                    category: None,
                },
            ],
        };

        result.retain_meaningful_changes();

        assert_eq!(result.changes.len(), 1);
        assert_eq!(result.changes[0].original, "你");
        assert_eq!(result.changes[0].corrected, "我们");
    }
}
