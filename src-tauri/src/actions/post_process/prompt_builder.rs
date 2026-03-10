use crate::settings::LLMPrompt;
use log::debug;

/// Result of building a prompt for LLM submission.
/// Messages are structured as multiple system messages for clear separation of concerns.
pub struct BuiltPrompt {
    /// The combined single system prompt string
    pub system_prompt: String,
    /// User message: structured code blocks or plain text fallback
    pub user_message: Option<String>,
}

/// Unified prompt builder that consolidates variable processing logic
/// from pipeline.rs, manual.rs, extensions.rs, and routing.rs.
pub struct PromptBuilder<'a> {
    prompt: &'a LLMPrompt,
    transcription: &'a str,
    /// Original (unrouted) transcription, may differ from `transcription` after routing
    raw_transcription: Option<&'a str>,
    streaming_transcription: Option<&'a str>,
    selected_text: Option<&'a str>,
    app_name: Option<&'a str>,
    window_title: Option<&'a str>,
    history_entries: Vec<String>,
    hotword_injection: Option<String>,
}

impl<'a> PromptBuilder<'a> {
    pub fn new(prompt: &'a LLMPrompt, transcription: &'a str) -> Self {
        Self {
            prompt,
            transcription,
            raw_transcription: None,
            streaming_transcription: None,
            selected_text: None,
            app_name: None,
            window_title: None,
            history_entries: Vec::new(),
            hotword_injection: None,
        }
    }

    pub fn raw_transcription(mut self, raw: &'a str) -> Self {
        if !raw.is_empty() && raw != self.transcription {
            self.raw_transcription = Some(raw);
        }
        self
    }

    pub fn streaming_transcription(mut self, streaming: Option<&'a str>) -> Self {
        self.streaming_transcription = streaming.filter(|s| !s.is_empty());
        self
    }

    pub fn selected_text(mut self, text: Option<&'a str>) -> Self {
        self.selected_text = text.filter(|s| !s.is_empty());
        self
    }

    pub fn app_name(mut self, name: Option<&'a str>) -> Self {
        self.app_name = name.filter(|s| !s.is_empty());
        self
    }

    pub fn window_title(mut self, title: Option<&'a str>) -> Self {
        self.window_title = title.filter(|s| !s.is_empty());
        self
    }

    pub fn history_entries(mut self, entries: Vec<String>) -> Self {
        self.history_entries = entries;
        self
    }

    pub fn hotword_injection(mut self, injection: Option<String>) -> Self {
        self.hotword_injection = injection;
        self
    }

    /// Build the multi-message prompt structure.
    ///
    /// Message structure:
    /// - [System 1] Variable introduction (only when streaming/select data exists and template
    ///   doesn't explicitly reference variables)
    /// - [System 2] Skill instructions (clean, no hotwords or data explanations appended)
    /// - [System 3] Hotword correction table (only when hotwords exist)
    /// - [System 4] Context history (only when history exists and not inline-consumed)
    /// - [User]     Code blocks with data / plain text fallback
    pub fn build(self) -> BuiltPrompt {
        let template = &self.prompt.instructions;

        // --- Phase 1: Build base system prompt ---
        let mut skill_prompt = template.replace("${prompt}", &self.prompt.name);

        // Strip the "## 变量" section (backward compat with old templates)
        skill_prompt = strip_variables_section(&skill_prompt);

        // --- Phase 2: Detect explicit variable references in the STRIPPED template ---
        let has_output_ref = skill_prompt.contains("${output}");
        let has_streaming_ref = skill_prompt.contains("${streaming_output}");
        let has_select_ref = skill_prompt.contains("${select}");
        let has_raw_input_ref = skill_prompt.contains("${raw_input}");
        let has_context_ref = skill_prompt.contains("${context}");
        let has_app_name_ref = skill_prompt.contains("${app_name}");
        let has_window_title_ref = skill_prompt.contains("${window_title}");
        let has_time_ref = skill_prompt.contains("${time}");

        let has_streaming_data = self
            .streaming_transcription
            .map_or(false, |s| !s.is_empty());
        let has_select_data = self.selected_text.map_or(false, |s| !s.is_empty());
        let has_any_explicit_ref =
            has_output_ref || has_streaming_ref || has_select_ref || has_raw_input_ref;

        debug!(
            "[PromptBuilder] Variable refs: output={}, streaming={}, select={}, raw_input={}, context={}",
            has_output_ref, has_streaming_ref, has_select_ref, has_raw_input_ref, has_context_ref
        );
        debug!(
            "[PromptBuilder] Available data: streaming={}, select={}",
            has_streaming_data, has_select_data
        );

        // --- Phase 3: Clean inline variable markers ---
        if has_output_ref {
            skill_prompt = skill_prompt.replace("${output}", "output");
        }
        if has_streaming_ref {
            skill_prompt = skill_prompt.replace("${streaming_output}", "streaming_output");
        }
        if has_select_ref {
            skill_prompt = skill_prompt.replace("${select}", "select");
        }
        if has_raw_input_ref {
            skill_prompt = skill_prompt.replace("${raw_input}", "raw_input");
        }

        // Inline-replace metadata variables
        if has_app_name_ref {
            if let Some(name) = self.app_name {
                skill_prompt = skill_prompt.replace("${app_name}", name);
            }
        }
        if has_window_title_ref {
            if let Some(title) = self.window_title {
                skill_prompt = skill_prompt.replace("${window_title}", title);
            }
        }
        if has_time_ref {
            let now = chrono::Local::now();
            let time_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
            skill_prompt = skill_prompt.replace("${time}", &time_str);
        }

        // Handle ${context} — inline replace or defer to history
        let mut history_entries = self.history_entries;
        if !history_entries.is_empty() && has_context_ref && skill_prompt.contains("${context}") {
            let context_content = history_entries
                .iter()
                .map(|s| format!("- {}", s))
                .collect::<Vec<_>>()
                .join("\n");
            let context_block = format!(
                "\n\n[ASR上下文] 当前应用近期识别的上下文,用于推断讨论的领域和话题,仅供语境参考。\n{}\n\n",
                context_content
            );
            skill_prompt = skill_prompt.replace("${context}", &context_block);
            history_entries.clear();
        }

        // --- Phase 4: Build single system prompt string ---
        let mut system_prompt = String::new();

        // 1. Variable introduction
        // Only when supplementary data exists and template doesn't explicitly reference variables
        if !has_any_explicit_ref && (has_streaming_data || has_select_data) {
            system_prompt.push_str(
                "## 变量说明\n\
                系统会在后续输入中以代码块的形式提供以下变量：\n\
                - `output`：语音识别的最终输出文本，代表用户的主要意图\n\
                - `streaming_output`：实时转录的中间文本（包含可能的识别误差），用于辅助理解语义\n\
                - `select`：用户在使用快捷键唤醒时光标所选中的屏幕文本内容\n\
                - `raw_input`：未经过滤或路由的原始语音输入\n\
                请结合这些变量内容执行指定的任务。\n\n---\n\n",
            );
        }

        // 2. Skill instructions (always present)
        system_prompt.push_str(&skill_prompt);

        // 3. Hotword correction table
        if let Some(injection) = &self.hotword_injection {
            if !injection.is_empty() {
                system_prompt.push_str("\n\n---\n\n");
                system_prompt.push_str(injection);
            }
        }

        // 4. Context history
        if !history_entries.is_empty() && !has_context_ref {
            let context_content = history_entries
                .iter()
                .map(|s| format!("- {}", s))
                .collect::<Vec<_>>()
                .join("\n");
            system_prompt.push_str(&format!(
                "\n\n---\n\n## ASR 上下文\n当前应用近期识别的上下文,用于推断讨论的领域和话题,仅供语境参考。\n{}",
                context_content
            ));
        }

        // --- Phase 5: Build user message (code blocks or fallback) ---
        let mut input_data_parts: Vec<String> = Vec::new();

        if has_any_explicit_ref {
            // Template explicitly handles variables — only inject what it DOESN'T cover.
            if !has_output_ref && !self.transcription.is_empty() {
                input_data_parts.push(format!("```output\n{}\n```", self.transcription));
            }
            if !has_streaming_ref {
                if let Some(streaming) = self.streaming_transcription {
                    input_data_parts.push(format!("```streaming_output\n{}\n```", streaming));
                }
            }
            if !has_select_ref {
                if let Some(text) = self.selected_text {
                    input_data_parts.push(format!("```select\n{}\n```", text));
                }
            }
            if has_raw_input_ref {
                if let Some(raw) = self.raw_transcription {
                    input_data_parts.push(format!("```raw_input\n{}\n```", raw));
                }
            }
        } else if has_streaming_data || has_select_data {
            // No explicit refs but supplementary data exists → use code blocks
            if !self.transcription.is_empty() {
                input_data_parts.push(format!("```output\n{}\n```", self.transcription));
            }
            if let Some(streaming) = self.streaming_transcription {
                input_data_parts.push(format!("```streaming_output\n{}\n```", streaming));
            }
            if let Some(text) = self.selected_text {
                input_data_parts.push(format!("```select\n{}\n```", text));
            }
        }

        let user_message = if !input_data_parts.is_empty() {
            Some(input_data_parts.join("\n\n"))
        } else if !has_any_explicit_ref && !self.transcription.is_empty() {
            // No extras, no explicit refs → plain text fallback
            Some(self.transcription.to_string())
        } else {
            None
        };

        BuiltPrompt {
            system_prompt,
            user_message,
        }
    }
}

/// Strip the `## 变量` section from a prompt template.
///
/// This section is used as a declaration for the system to know which data blocks
/// to inject. It typically looks like:
///
/// ```markdown
/// ## 变量
///
/// ```output
/// ${output}
/// ```
///
/// ```streaming_output
/// ${streaming_output}
/// ```
/// ```
///
/// We remove everything from `## 变量` to the end of the last code-block in that section.
fn strip_variables_section(prompt: &str) -> String {
    // Find the "## 变量" header
    let marker = "## 变量";
    let Some(section_start) = prompt.find(marker) else {
        return prompt.to_string();
    };

    // Take everything before the marker
    let before = prompt[..section_start].trim_end();

    // Look at what comes after the ## 变量 section.
    // We need to find the end: it's either:
    // - The next ## heading (a new section)
    // - The end of the string
    let after_marker = &prompt[section_start + marker.len()..];

    // Look for the next "## " heading that isn't "## 变量"
    if let Some(next_heading_offset) = find_next_heading(after_marker) {
        let after = &after_marker[next_heading_offset..];
        format!("{}\n\n{}", before, after)
    } else {
        // ## 变量 is the last section — just trim
        before.to_string()
    }
}

/// Find the byte offset of the next markdown heading (`## ` or `# `) in the text.
fn find_next_heading(text: &str) -> Option<usize> {
    for (i, _) in text.char_indices() {
        if i == 0 {
            continue; // skip the start since we're inside ## 变量
        }
        let remaining = &text[i..];
        if remaining.starts_with("\n## ") || remaining.starts_with("\n# ") {
            return Some(i + 1); // +1 to skip the newline, point at the #
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{LLMPrompt, Skill};

    fn make_prompt(instructions: &str) -> LLMPrompt {
        Skill {
            id: "test".to_string(),
            name: "Test Skill".to_string(),
            instructions: instructions.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn test_strip_variables_section_at_end() {
        let input = r#"# Expert
Do something with `output`.

## 变量

```output
${output}
```

```streaming_output
${streaming_output}
```"#;

        let result = strip_variables_section(input);
        assert_eq!(result, "# Expert\nDo something with `output`.");
        assert!(!result.contains("## 变量"));
        assert!(!result.contains("${output}"));
    }

    #[test]
    fn test_strip_variables_section_in_middle() {
        let input = r#"# Expert

## 变量

```output
${output}
```

## 输出要求

直接输出文本。"#;

        let result = strip_variables_section(input);
        assert!(result.contains("# Expert"));
        assert!(result.contains("## 输出要求"));
        assert!(!result.contains("## 变量"));
        assert!(!result.contains("${output}"));
    }

    #[test]
    fn test_strip_variables_section_not_present() {
        let input = "# Expert\nDo something.";
        let result = strip_variables_section(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_build_with_output_variable() {
        // Old-style template with ## 变量 section — section gets stripped,
        // no explicit refs remain in the body → fallback plain text.
        let prompt = make_prompt(
            r#"# Expert
Process the `output` code block.

## 变量

```output
${output}
```"#,
        );

        let built = PromptBuilder::new(&prompt, "Hello world").build();

        let sys_combined = built.system_prompt;
        // System prompt should not contain ## 变量 or ${output}
        assert!(!sys_combined.contains("## 变量"));
        assert!(!sys_combined.contains("${output}"));
        assert!(sys_combined.contains("Process the `output` code block."));

        // No streaming/select data → fallback as plain text
        assert_eq!(built.user_message.as_deref(), Some("Hello world"));
    }

    #[test]
    fn test_build_without_variables_plain_fallback() {
        // No variables, no streaming, no select → plain text fallback
        let prompt = make_prompt("# Expert\nProcess the user's input.");

        let built = PromptBuilder::new(&prompt, "Hello world").build();

        // No code blocks needed — simple fallback
        assert_eq!(built.user_message.as_deref(), Some("Hello world"));
        // No supplementary notes in system prompt
        let sys_combined = built.system_prompt;
        assert!(!sys_combined.contains("基于以下代码块的信息"));
    }

    #[test]
    fn test_build_with_streaming_auto_inject() {
        // No variable refs, but streaming data available → auto-inject with explanation
        let prompt = make_prompt("# Expert\nProcess the input.");

        let built = PromptBuilder::new(&prompt, "Final text")
            .streaming_transcription(Some("Fianl txt"))
            .build();

        // System prompt should have supplementary notes
        let sys_combined = built.system_prompt;
        assert!(sys_combined.contains("系统会在后续输入中以代码块的形式提供以下变量："));
        assert!(sys_combined.contains("`streaming_output`"));

        // Input data should contain both code blocks
        let input = built.user_message.unwrap();
        assert!(input.contains("```output\nFinal text\n```"));
        assert!(input.contains("```streaming_output\nFianl txt\n```"));
    }

    #[test]
    fn test_build_with_select_auto_inject() {
        // No variable refs, but select data available → auto-inject
        let prompt = make_prompt("# Expert\nProcess the input.");

        let built = PromptBuilder::new(&prompt, "translate this")
            .selected_text(Some("Selected paragraph"))
            .build();

        let sys_combined = built.system_prompt;
        // System prompt should have supplementary notes mentioning select
        assert!(sys_combined.contains("系统会在后续输入中以代码块的形式提供以下变量："));
        assert!(sys_combined.contains("`select`"));

        let input = built.user_message.unwrap();
        assert!(input.contains("```output\ntranslate this\n```"));
        assert!(input.contains("```select\nSelected paragraph\n```"));
    }

    #[test]
    fn test_build_with_select() {
        let prompt = make_prompt(
            r#"# Expert
Process `select` if available, otherwise `output`.

## 变量

```output
${output}
```

```select
${select}
```"#,
        );

        let built = PromptBuilder::new(&prompt, "voice command")
            .selected_text(Some("Selected paragraph"))
            .build();

        let input = built.user_message.unwrap();
        assert!(input.contains("```output\nvoice command\n```"));
        assert!(input.contains("```select\nSelected paragraph\n```"));
    }

    #[test]
    fn test_build_with_inline_variables() {
        let prompt =
            make_prompt("# Expert\nApp: ${app_name}, Window: ${window_title}, Time: ${time}");

        let built = PromptBuilder::new(&prompt, "test")
            .app_name(Some("VSCode"))
            .window_title(Some("main.rs"))
            .build();

        let sys_combined = built.system_prompt;
        assert!(sys_combined.contains("App: VSCode"));
        assert!(sys_combined.contains("Window: main.rs"));
        assert!(!sys_combined.contains("${app_name}"));
        assert!(!sys_combined.contains("${window_title}"));
        // ${time} should be replaced with actual time
        assert!(!sys_combined.contains("${time}"));
    }

    #[test]
    fn test_build_with_context_inline() {
        let prompt = make_prompt("# Expert\nContext: ${context}\nProcess output.");

        let built = PromptBuilder::new(&prompt, "test")
            .history_entries(vec!["entry1".to_string(), "entry2".to_string()])
            .build();

        let sys_combined = built.system_prompt;
        assert!(sys_combined.contains("- entry1"));
        assert!(sys_combined.contains("- entry2"));
        assert!(!sys_combined.contains("${context}"));
        // History entries consumed inline, so it's joined into system messages
    }

    #[test]
    fn test_build_with_hotword_injection() {
        let prompt = make_prompt("# Expert\nProcess input.");

        let built = PromptBuilder::new(&prompt, "test")
            .hotword_injection(Some("## 热词\n- 误识别 → 正确".to_string()))
            .build();

        let sys_combined = built.system_prompt;
        assert!(sys_combined.contains("## 热词\n- 误识别 → 正确"));
    }
}
