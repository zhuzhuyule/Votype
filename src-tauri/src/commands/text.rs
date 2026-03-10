use crate::actions::post_process;
use crate::managers::prompt::{self, PromptManager};
use crate::settings;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn optimize_text_with_llm(
    app_handle: AppHandle,
    prompt_manager: State<'_, Arc<PromptManager>>,
    text: String,
    instruction: Option<String>,
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
        .post_process_models
        .get(provider_id)
        .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;

    log::info!(
        "Optimizing text with LLM: provider={}, model={}, instruction={:?}",
        provider.label,
        model,
        instruction
    );

    let system_prompt = prompt_manager
        .get_prompt(&app_handle, "system_text_optimization")
        .map_err(|e| format!("Failed to load system prompt: {}", e))?;

    let user_instruction =
        instruction.unwrap_or_else(|| "优化这个提示词，使其更专业、结构更清晰。".to_string());
    let user_content = format!("{}\n\n待优化的提示词内容：\n\n{}", user_instruction, text);

    let (optimized_text, _err) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        model,
        None,
        &system_prompt,      // System message: optimization instructions
        Some(&user_content), // User message: text to optimize
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
        .post_process_models
        .get(provider_id)
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

    let (description, _err) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        model,
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
pub async fn translate_review_text(
    app_handle: AppHandle,
    text: String,
    _original_text: String,
    user_locale: String,
) -> Result<TranslationResult, String> {
    let settings = settings::get_settings(&app_handle);

    // Try to use intent model (fast model) first for quick translation
    let (provider, model) = if let Some(intent_model_id) = &settings.post_process_intent_model_id {
        if let Some(cached_model) = settings
            .cached_models
            .iter()
            .find(|cached| cached.id == *intent_model_id)
        {
            if cached_model.model_type == crate::settings::ModelType::Text {
                if let Some(intent_provider) =
                    settings.post_process_provider(&cached_model.provider_id)
                {
                    let model_id = cached_model.model_id.trim().to_string();
                    if !model_id.is_empty() {
                        log::info!(
                            "Using intent model for translation: provider={}, model={}",
                            intent_provider.label,
                            model_id
                        );
                        (intent_provider, model_id)
                    } else {
                        // Fallback to standard model
                        let provider_id = &settings.post_process_provider_id;
                        let provider = settings
                            .post_process_providers
                            .iter()
                            .find(|p| p.id == *provider_id)
                            .ok_or_else(|| "Post-processing provider not found".to_string())?;
                        let model =
                            settings
                                .post_process_models
                                .get(provider_id)
                                .ok_or_else(|| {
                                    format!("No model configured for provider {}", provider_id)
                                })?;
                        (provider, model.clone())
                    }
                } else {
                    // Fallback to standard model
                    let provider_id = &settings.post_process_provider_id;
                    let provider = settings
                        .post_process_providers
                        .iter()
                        .find(|p| p.id == *provider_id)
                        .ok_or_else(|| "Post-processing provider not found".to_string())?;
                    let model = settings
                        .post_process_models
                        .get(provider_id)
                        .ok_or_else(|| {
                            format!("No model configured for provider {}", provider_id)
                        })?;
                    (provider, model.clone())
                }
            } else {
                // Not a text model, fallback
                let provider_id = &settings.post_process_provider_id;
                let provider = settings
                    .post_process_providers
                    .iter()
                    .find(|p| p.id == *provider_id)
                    .ok_or_else(|| "Post-processing provider not found".to_string())?;
                let model = settings
                    .post_process_models
                    .get(provider_id)
                    .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;
                (provider, model.clone())
            }
        } else {
            // Intent model not found in cache, fallback
            let provider_id = &settings.post_process_provider_id;
            let provider = settings
                .post_process_providers
                .iter()
                .find(|p| p.id == *provider_id)
                .ok_or_else(|| "Post-processing provider not found".to_string())?;
            let model = settings
                .post_process_models
                .get(provider_id)
                .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;
            (provider, model.clone())
        }
    } else {
        // No intent model configured, use standard model
        let provider_id = &settings.post_process_provider_id;
        let provider = settings
            .post_process_providers
            .iter()
            .find(|p| p.id == *provider_id)
            .ok_or_else(|| "Post-processing provider not found".to_string())?;
        let model = settings
            .post_process_models
            .get(provider_id)
            .ok_or_else(|| format!("No model configured for provider {}", provider_id))?;
        (provider, model.clone())
    };

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
        Output only the translated text, nothing else.",
        locale_lang = locale_language
    );

    let user_content = text;

    let (response, _err) = post_process::execute_llm_request(
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
        .post_process_models
        .get(provider_id)
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

    let (response, _err) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        model,
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
