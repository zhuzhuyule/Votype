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
    let processed_prompt = format!("{}\n\n待优化的提示词内容：\n\n{}", user_instruction, text);

    let (optimized_text, _err) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        model,
        None,
        &processed_prompt,
        Some(&format!("system: {}", system_prompt)), // Use input_data_message for system context
        None,                                        // No fallback needed
        Vec::new(),                                  // No history needed
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
        &user_content,
        Some(&format!("system: {}", system_prompt)),
        None,
        Vec::new(),
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
