use crate::actions::post_process;
use crate::settings;
use tauri::AppHandle;

#[tauri::command]
pub async fn optimize_text_with_llm(
    app_handle: AppHandle,
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

    let system_prompt = r#"你是一位世界级的提示词工程师，专门负责优化 Votype（离线语音助手）的提示词模板。
你的任务是重构用户提供的提示词，使其逻辑更严密、结构更清晰、对 AI 模型更友好。

Votype 环境变量支持：
- `${output}`：当前语音转录出的原始文本（必需/核心占位符）。
- `${streaming_output}`：实时转录过程产生的转录文本（作为 output 的参考）。
- `${hot_words}`：用户配置的自定义热词列表（有助于纠偏专业术语）。
- `${context}`：最近 1～30 次转录的最终结果，作为上下文信息来提高 output 的语境。
- `${prompt}`：提示词方案的显示名称。

优化逻辑：
1. **智能补全**：如果提示词中缺少 `${output}`，请根据逻辑将其插入到指令的输入位置（通常是结尾或作为待处理对象）。
2. **结构重组**：使用 Markdown 标题（# ##）、列表和代码块来划分“角色”、“背景”、“任务”和“输出要求”。
3. **角色增强**：为提示词注入一个强有力的专家角色。
4. **约束对齐**：明确输出的长度、语言风格或禁止事项。

输出要求：
- 请直接返回优化后的 Markdown 提示词源码。
- 严禁包含任何前缀（如“好的”、“这是优化后的结果”）、解释说明或后缀。
"#;

    let user_instruction =
        instruction.unwrap_or_else(|| "优化这个提示词，使其更专业、结构更清晰。".to_string());
    let processed_prompt = format!("{}\n\n待优化的提示词内容：\n\n{}", user_instruction, text);

    // Reuse existing execute_llm_request logic
    // Note: execute_llm_request usually handles confidence checks and returns a tuple
    let (optimized_text, _success, _confidence, _reason) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        model,
        &processed_prompt,
        vec![format!("system: {}", system_prompt)], // simplified historical role injection if needed, or just system prompt
        None,
        false, // disable confidence check for this internal optimization
    )
    .await;

    optimized_text.ok_or_else(|| "Failed to get response from LLM".to_string())
}
