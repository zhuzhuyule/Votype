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

Votype 变量机制：
系统会自动将输入数据作为独立消息发送给 AI，用户只需在提示词中**引用变量名**即可：
- `${output}`：语音转录的最终文本（已去除命令前缀和别名）。
- `${raw_input}`：完整的原始转录文本（包含命令前缀和别名）。
- `${select}`：录音结束时当前选中的文本内容。
- `${streaming_output}`：实时转录过程产生的中间文本，与 `${output}` 协作可提高识别准确性。
- `${hot_words}`：用户配置的自定义热词列表。
- `${context}`：最近 1～30 次转录的历史记录，用于上下文理解。
- `${prompt}`：提示词方案的显示名称（会直接替换）。

**重要：Fallback 机制**
如果提示词中没有引用 `${output}`、`${raw_input}`、`${select}` 中的任何一个，系统会**自动在末尾追加**用户的转录输入内容。因此，你可以直接生成纯任务描述的提示词，无需强行插入变量。

优化逻辑：
1. **智能选择变量**：根据用户提示词的意图，智能决定使用哪些变量。不要一股脑把所有变量都加进去，只添加有意义的变量。
2. **纯 Prompt 允许**：如果原始提示词是纯任务描述，可以保持不加变量，依赖系统的 Fallback 机制。
3. **融合输出**：`${output}` 和 `${streaming_output}` 协作使用可提高识别准确性，适用于需要对输入内容准确较高的场景。比如：中英混读、中英混写等。
4. **结构重组**：使用 Markdown 标题（# ##）、列表和代码块来划分"角色"、"背景"、"任务"和"输出要求"。
5. **角色增强**：为提示词注入一个强有力的专家角色。

输出要求：
- 请直接返回优化后的 Markdown 提示词源码。
- 严禁包含任何前缀（如"好的"、"这是优化后的结果"）、解释说明或后缀。
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

    let system_prompt = format!(
        r#"You are an expert AI System Architect specializing in "Skill Routing" for LLMs.
Your task is to generate high-density Skill Descriptions for Votype to ensure precise agent routing.

Generation Principles (following Claude Code best practices):
1. **Identity & Capabilities**: Define the expert persona (e.g., "React component expert").
2. **Trigger & Intent**: Explicitly state WHEN to activate this skill (e.g., "Activate when the user asks for optimization...").
3. **Third-Person Perspective**: ALWAYS use "Analyzes...", "Generates...", "Refactors..." (Never "I can..." or "Helps you...").
4. **Precision**: Use strong technical verbs and specific domain keywords.
5. **Conciseness**: Strictly 1-3 sentences. Maximum information density.

Output Rules:
- Return ONLY the description text.
- NO quotes, NO conversational filler, NO explanations.
- {}
"#,
        language_instruction
    );

    let user_content = format!("Skill 名称：{}\nSkill 指令：\n{}", name, instructions);

    let (description, _success, _confidence, _reason) = post_process::execute_llm_request(
        &app_handle,
        &settings,
        provider,
        model,
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
