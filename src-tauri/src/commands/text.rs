use crate::actions::post_process;
use crate::managers::prompt::{self, PromptManager};
use crate::settings;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};

fn resolve_translation_target(
    settings: &settings::AppSettings,
) -> Result<(&settings::PostProcessProvider, String), String> {
    let resolve_standard = || -> Result<(&settings::PostProcessProvider, String), String> {
        let provider_id = &settings.post_process_provider_id;
        let provider = settings
            .post_process_provider(provider_id)
            .ok_or_else(|| "Post-processing provider not found".to_string())?;
        let model = settings
            .resolve_model_for_provider(provider_id)
            .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;
        Ok((provider, model))
    };

    (|| -> Result<_, String> {
        let preferred_model_id = settings
            .post_process_translation_model
            .as_ref()
            .map(|c| &c.primary_id)
            .or_else(|| {
                settings
                    .post_process_intent_model
                    .as_ref()
                    .map(|c| &c.primary_id)
            });

        let cached_model_id = match preferred_model_id {
            Some(id) => id,
            None => return resolve_standard(),
        };
        let cached_model = match settings
            .cached_models
            .iter()
            .find(|c| c.id == *cached_model_id)
        {
            Some(cm) if cm.model_type == crate::settings::ModelType::Text => cm,
            _ => return resolve_standard(),
        };
        let intent_provider = match settings.post_process_provider(&cached_model.provider_id) {
            Some(p) => p,
            None => return resolve_standard(),
        };
        let model_id = cached_model.model_id.trim().to_string();
        if model_id.is_empty() {
            return resolve_standard();
        }
        log::info!(
            "Using configured translation target: provider={}, model={}",
            intent_provider.label,
            model_id
        );
        Ok((intent_provider, model_id))
    })()
}

pub async fn translate_text_to_english(
    app_handle: &AppHandle,
    text: &str,
) -> Result<String, String> {
    let settings = settings::get_settings(app_handle);
    let (provider, model) = resolve_translation_target(&settings)?;

    log::info!(
        "Translating text to English: provider={}, model={}, chars={}",
        provider.label,
        model,
        text.chars().count()
    );

    let system_prompt = "You are a fast translator. Translate the given text into natural, concise English. Preserve intent, formatting, lists, and code-like tokens when possible. If the input is long or covers multiple ideas, break the output into short paragraphs separated by blank lines so it reads comfortably; keep short input as a single block. Output only the translated English text, with no explanations or quotes.";

    let (response, _err, _error_message, _token_count) = post_process::execute_llm_request(
        app_handle,
        &settings,
        provider,
        &model,
        None,
        system_prompt,
        Some(text),
        None,
        None,
        None,
        None,
    )
    .await;

    let translated_text =
        response.ok_or_else(|| "Failed to get translation from LLM".to_string())?;

    Ok(translated_text.trim().to_string())
}

#[tauri::command]
pub async fn optimize_text_with_llm(
    app_handle: AppHandle,
    prompt_manager: State<'_, Arc<PromptManager>>,
    text: String,
    instruction: Option<String>,
    skill_id: Option<String>,
) -> Result<String, String> {
    let settings = settings::get_settings(&app_handle);
    let provider_id = &settings.post_process_provider_id;

    // Find the provider
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == *provider_id)
        .ok_or_else(|| "Post-processing provider not found".to_string())?;

    // Find the model for the current provider
    let model = settings
        .resolve_model_for_provider(provider_id)
        .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;

    log::info!(
        "Optimizing text with LLM: provider={}, model={}, instruction={:?}, skill_id={:?}",
        provider.label,
        model,
        instruction,
        skill_id,
    );

    let system_prompt = prompt_manager
        .get_prompt(&app_handle, "system_text_optimization")
        .map_err(|e| format!("Failed to load system prompt: {}", e))?;

    // If skill_id is provided, load its reference files as context
    let references_context = if let Some(ref sid) = skill_id {
        let skill_manager = crate::managers::skill::SkillManager::new(&app_handle);
        if let Some(skill_path) = skill_manager.find_skill_file_path(sid) {
            // Load ALL references for this skill (regardless of current app)
            let refs_dir = skill_path.parent().map(|d| d.join("references"));
            if let Some(refs_dir) = refs_dir.filter(|d| d.is_dir()) {
                let mut ref_contents = Vec::new();
                if let Ok(entries) = std::fs::read_dir(&refs_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md")
                        {
                            let name = path
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("unknown");
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                let content = content.trim();
                                if !content.is_empty() {
                                    ref_contents
                                        .push(format!("### Reference: {}\n\n{}", name, content));
                                }
                            }
                        }
                    }
                }
                if !ref_contents.is_empty() {
                    log::info!(
                        "Loaded {} reference(s) for optimization context",
                        ref_contents.len()
                    );
                    Some(ref_contents.join("\n\n---\n\n"))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let user_instruction =
        instruction.unwrap_or_else(|| "优化这个提示词，使其更专业、结构更清晰。".to_string());

    let user_content = if let Some(ref refs) = references_context {
        format!(
            "{}\n\n## 待优化的 Skill 正文\n\n{}\n\n## 该 Skill 已有的场景 Reference 文件\n\n以下是该 Skill 的 reference 文件内容，优化正文时请确保与这些场景规则保持一致性（不要在正文中重复 reference 里的内容）：\n\n{}",
            user_instruction, text, refs
        )
    } else {
        format!("{}\n\n待优化的提示词内容：\n\n{}", user_instruction, text)
    };

    let (optimized_text, _err, _error_message, _token_count) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        &model,
        None,
        &system_prompt,      // System message: optimization instructions
        Some(&user_content), // User message: text to optimize + references context
        None,
        None,
        None,
        None,
    )
    .await;

    optimized_text.ok_or_else(|| "Failed to get response from LLM".to_string())
}

#[tauri::command]
pub async fn generate_skill_description(
    app_handle: AppHandle,
    prompt_manager: State<'_, Arc<PromptManager>>,
    name: String,
    instructions: String,
    locale: Option<String>,
) -> Result<String, String> {
    let settings = settings::get_settings(&app_handle);

    let provider_id = &settings.post_process_provider_id;
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| &p.id == provider_id)
        .ok_or_else(|| "Post-processing provider not found".to_string())?;

    let model = settings
        .resolve_model_for_provider(provider_id)
        .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;

    log::info!(
        "Generating skill description for: name={}, provider={}, model={}, locale={:?}",
        name,
        provider.label,
        model,
        locale
    );

    let is_chinese = locale
        .as_ref()
        .map(|l| l.starts_with("zh"))
        .unwrap_or(false);

    let language_instruction = if is_chinese {
        "Output MUST be in Chinese (Simplified)."
    } else {
        "Output MUST be in English."
    };

    let template = prompt_manager
        .get_prompt(&app_handle, "system_skill_description")
        .map_err(|e| format!("Failed to load system prompt: {}", e))?;

    let mut vars = HashMap::new();
    vars.insert("LANGUAGE_INSTRUCTION", language_instruction.to_string());
    let system_prompt = prompt::substitute_variables(&template, &vars);

    let user_content = format!("Skill 名称：{}\nSkill 指令：\n{}", name, instructions);

    let (description, _err, _error_message, _token_count) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        &model,
        None,
        &system_prompt,      // System message: generation instructions
        Some(&user_content), // User message: skill name + instructions
        None,
        None,
        None,
        None,
    )
    .await;

    description
        .map(|d| d.trim().trim_matches('"').to_string())
        .ok_or_else(|| "Failed to generate description from LLM".to_string())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TranslationResult {
    pub translated_text: String,
}

#[tauri::command]
pub async fn translate_text_to_english_command(
    app_handle: AppHandle,
    text: String,
) -> Result<TranslationResult, String> {
    let translated_text = translate_text_to_english(&app_handle, &text).await?;
    Ok(TranslationResult { translated_text })
}

#[tauri::command]
pub async fn translate_review_text(
    app_handle: AppHandle,
    text: String,
    original_text: String,
    user_locale: String,
) -> Result<TranslationResult, String> {
    let settings = settings::get_settings(&app_handle);
    let (provider, model) = resolve_translation_target(&settings)?;

    log::info!(
        "Translating review text: provider={}, model={}, user_locale={}",
        provider.label,
        model,
        user_locale
    );

    // Determine user's locale language
    let is_chinese_locale = user_locale.starts_with("zh");
    let locale_language = if is_chinese_locale {
        "Chinese (Simplified)"
    } else {
        "English"
    };

    // Simple translation rules:
    // - If polished text is in locale language → translate to English
    // - If polished text is NOT in locale language → translate to locale language
    let system_prompt = format!(
        "You are a fast translator. Translate the given text following these rules: \
        \
        **Rules:** \
        - IF text is in {locale_lang} → Translate to English \
        - IF text is in any other language → Translate to {locale_lang} \
        \
        If the input is long or covers multiple ideas, break the output into short paragraphs separated by blank lines so it reads comfortably; keep short input as a single block. \
        \
        Output only the translated text, nothing else.",
        locale_lang = locale_language
    );

    let _ = original_text;
    let user_content = text;

    let (response, _err, _error_message, _token_count) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        &model,
        None,
        &system_prompt,
        Some(&user_content),
        None,
        None,
        None,
        None,
    )
    .await;

    let translated_text =
        response.ok_or_else(|| "Failed to get translation from LLM".to_string())?;

    Ok(TranslationResult {
        translated_text: translated_text.trim().to_string(),
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SkillMetadata {
    pub name: String,
    pub icon: String,
}

#[tauri::command]
pub async fn generate_skill_metadata(
    app_handle: AppHandle,
    prompt_manager: State<'_, Arc<PromptManager>>,
    instructions: String,
    locale: Option<String>,
) -> Result<SkillMetadata, String> {
    let settings = settings::get_settings(&app_handle);

    let provider_id = &settings.post_process_provider_id;
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| &p.id == provider_id)
        .ok_or_else(|| "Post-processing provider not found".to_string())?;

    let model = settings
        .resolve_model_for_provider(provider_id)
        .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;

    log::info!(
        "Generating skill metadata: provider={}, model={}, locale={:?}",
        provider.label,
        model,
        locale
    );

    let is_chinese = locale
        .as_ref()
        .map(|l| l.starts_with("zh"))
        .unwrap_or(false);

    let language_instruction = if is_chinese {
        "The skill name MUST be in Chinese (Simplified)."
    } else {
        "The skill name MUST be in English."
    };

    let template = prompt_manager
        .get_prompt(&app_handle, "system_skill_metadata")
        .map_err(|e| format!("Failed to load system prompt: {}", e))?;

    let mut vars = HashMap::new();
    vars.insert("LANGUAGE_INSTRUCTION", language_instruction.to_string());
    vars.insert("INSTRUCTIONS", instructions);
    let system_prompt = prompt::substitute_variables(&template, &vars);

    let (response, _err, _error_message, _token_count) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        &model,
        None,
        &system_prompt,
        None,
        None,
        None,
        None,
        None,
    )
    .await;

    let response_text = response.ok_or_else(|| "Failed to get response from LLM".to_string())?;

    // Parse JSON from response — handle cases where LLM wraps in markdown code block
    let json_str = response_text
        .trim()
        .strip_prefix("```json")
        .or_else(|| response_text.trim().strip_prefix("```"))
        .unwrap_or(response_text.trim())
        .strip_suffix("```")
        .unwrap_or(response_text.trim())
        .trim();

    serde_json::from_str::<SkillMetadata>(json_str).map_err(|e| {
        format!(
            "Failed to parse LLM response as JSON: {}. Raw: {}",
            e, response_text
        )
    })
}
