#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{
    AppSettings, LLMPrompt, PostProcessProvider, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{error, info};
use serde::Deserialize;

use tauri::{AppHandle, Emitter};

fn clean_response_content(content: &str) -> String {
    let mut text = content
        .replace("\n", "\n")
        .replace("\t", "\t")
        .replace("\"", "\"")
        .replace("\\", "\\");

    while let Some(start) = text.find("<think>") {
        if let Some(end) = text[start..].find("</think>") {
            text.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }

    text.trim().to_string()
}

/// System prompt for confidence checking
const CONFIDENCE_SYSTEM_PROMPT: &str = r#"你是一个语音识别质量检测助手。只评估「处理后的文本」本身的质量，不需要解释中间过程。

请检查以下问题（仅用于整体评分，不需要逐字标注）：
- 含糊不清或无意义的词语
- 语句不通顺或语法错误
- 奇怪的符号或疑似乱码
- 明显的误识别（同音字/近音词错误等）
- 语句片段化或不完整
- 英文识别错误或拼写异常

评分说明：
- 置信度是最终文本整体准确率的估计（0-100）
- 只对“最终文本本身”做点评：如果通顺准确，reason 置空；只有当最终文本仍不通顺/有明显困惑点时才填写
- reason 仅描述最终文本的问题（例如语义不通顺、指代不清、语句残缺等），不要解释修改过程或为何改动

禁止事项：
- 不要解释“你是如何修改的”或“为何把某词改成某词”的过程
- 只关注最终文本是否自然、语义是否准确/是否与原意偏离过大


标点与格式要求：
- 必须保留输出文本中的标点符号，不要遗漏或丢失
- 如果你修正了标点或语气不通顺，必须在输出文本中体现

输出格式要求（仅输出 JSON，不要输出其他文本）：
{
  "text": "处理后的文本",
  "confidence": 0-100 的整数,
  "reason": "一句话点评（可为空，只有最终文本有问题时填写）"
}

只输出 JSON，不要 Markdown"#;

#[derive(Debug, Deserialize)]
struct LlmReviewResponse {
    pub text: Option<String>,
    pub confidence: Option<u8>,
    pub reason: Option<serde_json::Value>,
}

fn extract_json_block(content: &str) -> Option<String> {
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

fn normalize_reason(reason_value: serde_json::Value) -> Option<String> {
    let mut items: Vec<String> = Vec::new();
    match reason_value {
        serde_json::Value::String(value) => {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                items.push(trimmed.to_string());
            }
        }
        serde_json::Value::Array(values) => {
            for item in values {
                if let serde_json::Value::String(value) = item {
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        items.push(trimmed.to_string());
                    }
                }
            }
        }
        _ => {}
    }

    if items.is_empty() {
        None
    } else {
        Some(items.join("；"))
    }
}

/// Parse LLM response to extract text, confidence score, and reason
fn parse_response_with_confidence(content: &str) -> (String, Option<u8>, Option<String>) {
    let cleaned = clean_response_content(content);

    if let Some(json) = extract_json_block(&cleaned) {
        if let Ok(parsed) = serde_json::from_str::<LlmReviewResponse>(&json) {
            if let Some(text) = parsed.text {
                let mut confidence = parsed.confidence.map(|v| v.min(100));
                let reason = parsed.reason.and_then(normalize_reason);
                if reason.is_none() {
                    confidence = Some(100);
                }
                return (text, confidence, reason);
            }
        }
    }

    // Back-compat: Look for confidence marker at the end
    if let Some(pos) = cleaned.rfind("---CONFIDENCE:") {
        let text_part = cleaned[..pos].trim();
        let marker_part = &cleaned[pos + 14..]; // Skip "---CONFIDENCE:"

        if let Some(end_pos) = marker_part.find("---") {
            if let Ok(score) = marker_part[..end_pos].trim().parse::<u8>() {
                return (text_part.to_string(), Some(score.min(100)), None);
            }
        }
    }

    // No confidence marker found, return cleaned text with no score
    (cleaned, None, None)
}

fn resolve_effective_model(
    settings: &AppSettings,
    provider: &PostProcessProvider,
    prompt: &LLMPrompt,
) -> Option<String> {
    let resolve_from_id = |model_id_opt: Option<&String>| -> Option<String> {
        model_id_opt
            .filter(|id| !id.trim().is_empty())
            .and_then(|id| {
                settings
                    .cached_models
                    .iter()
                    .find(|m| m.id == *id && m.provider_id == provider.id)
            })
            .map(|m| m.model_id.clone())
    };

    resolve_from_id(prompt.model_id.as_ref())
        .or_else(|| resolve_from_id(settings.selected_prompt_model_id.as_ref()))
        .or_else(|| settings.post_process_models.get(&provider.id).cloned())
        .filter(|m| !m.trim().is_empty())
}

async fn execute_llm_request(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    processed_prompt: &str,
    enable_confidence_check: bool,
) -> (Option<String>, bool, Option<u8>, Option<String>) {
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                let _ = app_handle.emit(
                    "overlay-error",
                    serde_json::json!({ "code": "apple_intelligence_unavailable" }),
                );
                return (None, true, None, None);
            }

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(processed_prompt, token_limit) {
                Ok(result) => (Some(result), false, None, None), // Apple Intelligence doesn't support confidence check
                Err(err) => {
                    error!("Apple Intelligence failed: {}", err);
                    let _ = app_handle.emit(
                        "overlay-error",
                        serde_json::json!({ "code": "apple_intelligence_failed" }),
                    );
                    (None, true, None, None)
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

    let client = match crate::llm_client::create_client(provider, api_key) {
        Ok(client) => client,
        Err(e) => {
            error!("Failed to create LLM client: {}", e);
            let _ = app_handle.emit(
                "overlay-error",
                serde_json::json!({ "code": "llm_init_failed" }),
            );
            return (None, true, None, None);
        }
    };

    // Build messages list
    let mut messages: Vec<ChatCompletionRequestMessage> = Vec::new();

    // Add system prompt for confidence checking if enabled
    if enable_confidence_check {
        if let Ok(sys_msg) = ChatCompletionRequestSystemMessageArgs::default()
            .content(CONFIDENCE_SYSTEM_PROMPT)
            .build()
        {
            messages.push(ChatCompletionRequestMessage::System(sys_msg));
        }
    }

    // Add user message
    if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content(processed_prompt.to_string())
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(user_msg));
    }

    if messages.is_empty() || (enable_confidence_check && messages.len() < 2) {
        return (None, false, None, None);
    }

    let req = CreateChatCompletionRequestArgs::default()
        .model(model.to_string())
        .messages(messages)
        .build()
        .ok();

    if let Some(req) = req {
        match client.chat().create(req).await {
            Ok(resp) => {
                let content = resp
                    .choices
                    .first()
                    .and_then(|c| c.message.content.clone())
                    .unwrap_or_default();

                if enable_confidence_check {
                    let (text, confidence, reason) = parse_response_with_confidence(&content);
                    return (Some(text), false, confidence, reason);
                } else {
                    return (Some(clean_response_content(&content)), false, None, None);
                }
            }
            Err(err) => {
                error!("LLM request failed: {:?}", err);
                let _ = app_handle.emit(
                    "overlay-error",
                    serde_json::json!({ "code": "llm_request_failed" }),
                );
                return (None, true, None, None);
            }
        }
    }

    (None, false, None, None)
}

pub(crate) async fn maybe_post_process_transcription(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    show_overlay: bool,
    override_prompt_id: Option<String>,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<u8>,
    Option<String>,
) {
    if !settings.post_process_enabled {
        return (None, None, None, false, None, None);
    }

    let provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false, None, None),
    };

    // Determine the prompt to use and the effective input content
    let (prompt, transcription_content) = {
        let transcription_lower = transcription.trim().to_lowercase();

        // Helper to find the longest matching candidate with boundary checks, ignoring spaces
        let find_best_match = |text: &str, candidates: &[String]| -> Option<(String, usize)> {
            let mut best_match: Option<(String, usize)> = None;

            for candidate in candidates {
                let candidate_lower = candidate.trim().to_lowercase();
                if candidate_lower.is_empty() {
                    continue;
                }

                let mut text_chars = text.char_indices();
                let mut cand_chars = candidate_lower.chars();

                let mut matched = true;
                let mut text_match_end_idx = 0;
                let mut last_cand_char = None;

                let mut c_char_opt = cand_chars.next();

                while let Some(c_char) = c_char_opt {
                    if c_char.is_whitespace() {
                        c_char_opt = cand_chars.next();
                        continue;
                    }
                    last_cand_char = Some(c_char);

                    let mut found_char = false;
                    while let Some((idx, t_char)) = text_chars.next() {
                        if t_char.is_whitespace() {
                            continue;
                        }
                        if t_char == c_char {
                            found_char = true;
                            text_match_end_idx = idx + t_char.len_utf8();
                            break;
                        } else {
                            matched = false;
                            break;
                        }
                    }

                    if !found_char || !matched {
                        matched = false;
                        break;
                    }
                    c_char_opt = cand_chars.next();
                }

                if matched {
                    let ends_with_latin =
                        last_cand_char.map_or(false, |c| c.is_ascii_alphanumeric());

                    let is_boundary_ok = if !ends_with_latin {
                        true
                    } else if text_match_end_idx == text.len() {
                        true
                    } else {
                        let next_char = text[text_match_end_idx..].chars().next();
                        match next_char {
                            Some(c) => !c.is_ascii_alphanumeric(),
                            None => true,
                        }
                    };

                    if is_boundary_ok {
                        if best_match
                            .as_ref()
                            .map_or(true, |(_, len)| text_match_end_idx > *len)
                        {
                            best_match = Some((candidate.clone(), text_match_end_idx));
                        }
                    }
                }
            }
            best_match
        };

        // Parse command prefixes
        let prefixes: Vec<String> = settings
            .command_prefixes
            .as_ref()
            .map(|s| {
                s.split(&[',', '，'][..])
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let has_prefixes_configured = !prefixes.is_empty();

        let (content_to_check_alias, prefix_matched) = if has_prefixes_configured {
            if let Some((_, len)) = find_best_match(&transcription_lower, &prefixes) {
                let matched_str_lower = &transcription_lower[..len];
                let char_count = matched_str_lower.chars().count();

                let byte_offset_original = transcription
                    .char_indices()
                    .nth(char_count)
                    .map(|(i, _)| i)
                    .unwrap_or(transcription.len());

                let remaining =
                    transcription[byte_offset_original..].trim_start_matches(|c: char| {
                        c.is_whitespace() || c.is_ascii_punctuation() || "，。！？、".contains(c)
                    });

                (remaining.to_string(), true)
            } else {
                (transcription.to_string(), false)
            }
        } else {
            (transcription.to_string(), true)
        };

        let mut matched_prompt_info = None;

        if prefix_matched {
            let content_lower = content_to_check_alias.trim().to_lowercase();

            for p in &settings.post_process_prompts {
                let mut triggers = Vec::new();
                if let Some(alias_str) = &p.alias {
                    triggers.extend(
                        alias_str
                            .split(&[',', '，'][..])
                            .map(|s| s.trim().to_string()),
                    );
                }
                triggers.push(p.name.clone());

                if let Some((_, len)) = find_best_match(&content_lower, &triggers) {
                    matched_prompt_info = Some((p, len));
                    break;
                }
            }
        }

        if let Some((p, match_len_lower)) = matched_prompt_info {
            let matched_substring_lower =
                &content_to_check_alias.trim().to_lowercase()[..match_len_lower];
            let char_count = matched_substring_lower.chars().count();

            let byte_offset = content_to_check_alias
                .char_indices()
                .nth(char_count)
                .map(|(i, _)| i)
                .unwrap_or(content_to_check_alias.len());

            let final_content = content_to_check_alias[byte_offset..]
                .trim_start_matches(|c: char| {
                    c.is_whitespace() || c.is_ascii_punctuation() || "，。！？、".contains(c)
                })
                .to_string();

            (p, final_content)
        } else {
            let p = if let Some(pid) = &override_prompt_id {
                settings.post_process_prompts.iter().find(|p| &p.id == pid)
            } else {
                None
            }
            .or_else(|| {
                settings
                    .post_process_selected_prompt_id
                    .as_ref()
                    .and_then(|id| settings.post_process_prompts.iter().find(|p| &p.id == id))
            })
            .or_else(|| settings.post_process_prompts.first());

            match p {
                Some(p) => (p, transcription.to_string()),
                None => return (None, None, None, false, None, None),
            }
        }
    };

    let model = match resolve_effective_model(settings, provider, prompt) {
        Some(m) => m,
        None => return (None, None, Some(prompt.id.clone()), false, None, None),
    };

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    let processed_prompt = prompt
        .prompt
        .replace("${output}", &transcription_content)
        .replace("${streaming_output}", streaming_transcription.unwrap_or(""));

    // Check if confidence checking is enabled in settings
    let enable_confidence_check = settings.confidence_check_enabled;

    let (result, err, confidence, reason) = execute_llm_request(
        app_handle,
        settings,
        provider,
        &model,
        &processed_prompt,
        enable_confidence_check,
    )
    .await;
    (
        result,
        Some(model),
        Some(prompt.id.clone()),
        err,
        confidence,
        reason,
    )
}

pub(crate) async fn post_process_text_with_prompt(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    prompt: &LLMPrompt,
    show_overlay: bool,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<u8>,
    Option<String>,
) {
    let provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false, None, None),
    };

    let model = match resolve_effective_model(settings, provider, prompt) {
        Some(m) => m,
        None => return (None, None, Some(prompt.id.clone()), false, None, None),
    };

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    let processed_prompt = prompt
        .prompt
        .replace("${output}", transcription)
        .replace("${streaming_output}", streaming_transcription.unwrap_or(""));

    // For manual prompt processing, don't enable confidence checking
    let (result, err, confidence, reason) = execute_llm_request(
        app_handle,
        settings,
        provider,
        &model,
        &processed_prompt,
        false,
    )
    .await;

    if let Some(res) = &result {
        info!(
            "Manual LLM Task Completed | Model: {} | Result: {}...",
            model,
            res.chars().take(50).collect::<String>()
        );
    }

    (
        result,
        Some(model),
        Some(prompt.id.clone()),
        err,
        confidence,
        reason,
    )
}

pub(crate) async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        return None;
    }

    let config = if is_simplified {
        BuiltinConfig::Tw2sp
    } else {
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => Some(converter.convert(transcription)),
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}", e);
            None
        }
    }
}
