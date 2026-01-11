use log::{debug, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use tauri_plugin_log::LogLevel;
use tauri_plugin_store::StoreExt;

pub const APPLE_INTELLIGENCE_PROVIDER_ID: &str = "apple_intelligence";
pub const APPLE_INTELLIGENCE_DEFAULT_MODEL_ID: &str = "Apple Intelligence";
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShortcutBinding {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_binding: String,
    pub current_binding: String,
}

/// Skill type determines execution behavior
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SkillType {
    /// Text processing skill (polish, translate, etc.)
    #[default]
    Text,
    /// Action skill (open folder, query weather, etc.)
    Action,
}

/// Skill source indicates where the skill was loaded from
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SkillSource {
    /// Built-in skill shipped with the app
    #[default]
    Builtin,
    /// User-created skill in ~/.votype/skills/user/
    User,
    /// Imported third-party skill in ~/.votype/skills/imported/
    Imported,
    /// External skill referenced by path
    External { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    /// Description for LLM intent recognition (Agent Skills compatible)
    #[serde(default)]
    pub description: String,
    /// Instructions (SKILL.md body content)
    #[serde(alias = "prompt")]
    pub instructions: String,
    pub model_id: Option<String>,
    #[serde(alias = "alias")]
    pub aliases: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub skill_type: SkillType,
    #[serde(default)]
    pub source: SkillSource,
    #[serde(default)]
    pub compliance_check_enabled: bool,
    #[serde(default)]
    pub compliance_threshold: Option<u8>,
    #[serde(default)]
    pub output_mode: SkillOutputMode,
    /// Whether this skill is enabled (default: true)
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Whether this skill has been customized by user in settings
    /// If true, user's version takes priority over file-based version
    #[serde(default)]
    pub customized: bool,
    /// File path for external skills (user/imported source only)
    /// Skipped from serialization (runtime only)
    #[serde(skip)]
    pub file_path: Option<std::path::PathBuf>,
}

fn default_true() -> bool {
    true
}

/// Backward compatibility: LLMPrompt is now an alias for Skill
pub type LLMPrompt = Skill;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PostProcessProvider {
    pub id: String,
    pub label: String,
    pub base_url: String,
    #[serde(default)]
    pub allow_base_url_edit: bool,
    #[serde(default)]
    pub models_endpoint: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelType {
    Text,
    Asr,
    Other,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CachedModel {
    pub id: String,
    pub name: String,
    pub model_type: ModelType,
    pub provider_id: String,
    pub model_id: String,
    pub added_at: String,
    #[serde(default)]
    pub custom_label: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    None,
    Top,
    Bottom,
    #[serde(rename = "follow")]
    FollowCursor,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelUnloadTimeout {
    Never,
    Immediately,
    Min2,
    Min5,
    Min10,
    Min15,
    Hour1,
    Sec5, // Debug mode only
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PasteMethod {
    CtrlV,
    Direct,
    None,
    #[cfg(not(target_os = "macos"))]
    ShiftInsert,
    CtrlShiftV,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardHandling {
    DontModify,
    CopyToClipboard,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecordingRetentionPeriod {
    Never,
    PreserveLimit,
    Days3,
    Weeks2,
    Months3,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppReviewPolicy {
    /// Use global confidence threshold (default)
    Auto,
    /// Always show review window
    Always,
    /// Never show review window, direct insert
    Never,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TitleMatchType {
    /// Simple text contains matching
    Text,
    /// Regular expression matching
    Regex,
}

impl Default for TitleMatchType {
    fn default() -> Self {
        TitleMatchType::Text
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillOutputMode {
    /// Polish mode: ASR result -> AI refinement -> Insert. UI shows Diff.
    Polish,
    /// Chat mode: ASR result -> AI Q&A -> Preview. UI shows Markdown.
    Chat,
    /// Silent mode: No UI output (for Action skills)
    Silent,
}

pub type PromptOutputMode = SkillOutputMode;

impl Default for SkillOutputMode {
    fn default() -> Self {
        SkillOutputMode::Chat
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TitleRule {
    pub id: String,
    pub pattern: String,
    #[serde(default)]
    pub match_type: TitleMatchType,
    pub policy: AppReviewPolicy,
    pub prompt_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppProfile {
    pub id: String,
    pub name: String,
    pub policy: AppReviewPolicy,
    pub prompt_id: Option<String>,
    pub icon: Option<String>,
    /// Title-based sub-rules for this app group
    #[serde(default)]
    pub rules: Vec<TitleRule>,
}

impl Default for ModelUnloadTimeout {
    fn default() -> Self {
        ModelUnloadTimeout::Never
    }
}

impl Default for PasteMethod {
    fn default() -> Self {
        // Default to CtrlV for macOS and Windows, Direct for Linux
        #[cfg(target_os = "linux")]
        return PasteMethod::Direct;
        #[cfg(not(target_os = "linux"))]
        return PasteMethod::CtrlV;
    }
}

impl Default for ClipboardHandling {
    fn default() -> Self {
        ClipboardHandling::DontModify
    }
}

impl ModelUnloadTimeout {
    pub fn to_minutes(self) -> Option<u64> {
        match self {
            ModelUnloadTimeout::Never => None,
            ModelUnloadTimeout::Immediately => Some(0), // Special case for immediate unloading
            ModelUnloadTimeout::Min2 => Some(2),
            ModelUnloadTimeout::Min5 => Some(5),
            ModelUnloadTimeout::Min10 => Some(10),
            ModelUnloadTimeout::Min15 => Some(15),
            ModelUnloadTimeout::Hour1 => Some(60),
            ModelUnloadTimeout::Sec5 => Some(0), // Special case for debug - handled separately
        }
    }

    pub fn to_seconds(self) -> Option<u64> {
        match self {
            ModelUnloadTimeout::Never => None,
            ModelUnloadTimeout::Immediately => Some(0), // Special case for immediate unloading
            ModelUnloadTimeout::Sec5 => Some(5),
            _ => self.to_minutes().map(|m| m * 60),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SoundTheme {
    Marimba,
    Pop,
    Custom,
}

impl SoundTheme {
    fn as_str(&self) -> &'static str {
        match self {
            SoundTheme::Marimba => "marimba",
            SoundTheme::Pop => "pop",
            SoundTheme::Custom => "custom",
        }
    }

    pub fn to_start_path(&self) -> String {
        format!("resources/{}_start.wav", self.as_str())
    }

    pub fn to_stop_path(&self) -> String {
        format!("resources/{}_stop.wav", self.as_str())
    }
}

/* still handy for composing the initial JSON in the store ------------- */
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppSettings {
    pub bindings: HashMap<String, ShortcutBinding>,
    #[serde(default = "default_app_language")]
    pub app_language: String,
    pub push_to_talk: bool,
    pub audio_feedback: bool,
    #[serde(default = "default_audio_feedback_volume")]
    pub audio_feedback_volume: f32,
    #[serde(default = "default_sound_theme")]
    pub sound_theme: SoundTheme,
    #[serde(default = "default_start_hidden")]
    pub start_hidden: bool,
    #[serde(default = "default_autostart_enabled")]
    pub autostart_enabled: bool,
    #[serde(default = "default_update_checks_enabled")]
    pub update_checks_enabled: bool,
    #[serde(default = "default_onboarding_completed")]
    pub onboarding_completed: bool,
    #[serde(default = "default_model")]
    pub selected_model: String,
    #[serde(default = "default_always_on_microphone")]
    pub always_on_microphone: bool,
    #[serde(default)]
    pub selected_microphone: Option<String>,
    #[serde(default)]
    pub clamshell_microphone: Option<String>,
    #[serde(default)]
    pub selected_output_device: Option<String>,
    #[serde(default = "default_translate_to_english")]
    pub translate_to_english: bool,
    #[serde(default = "default_selected_language")]
    pub selected_language: String,
    #[serde(default = "default_overlay_position")]
    pub overlay_position: OverlayPosition,
    #[serde(default = "default_debug_mode")]
    pub debug_mode: bool,
    #[serde(default = "default_log_level")]
    pub log_level: LogLevel,
    #[serde(default)]
    pub custom_words: Vec<String>,
    #[serde(default)]
    pub model_unload_timeout: ModelUnloadTimeout,
    #[serde(default = "default_word_correction_threshold")]
    pub word_correction_threshold: f64,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
    #[serde(default = "default_recording_retention_period")]
    pub recording_retention_period: RecordingRetentionPeriod,
    #[serde(default)]
    pub paste_method: PasteMethod,
    #[serde(default)]
    pub clipboard_handling: ClipboardHandling,
    #[serde(default = "default_post_process_enabled")]
    pub post_process_enabled: bool,
    #[serde(default = "default_post_process_use_secondary_output")]
    pub post_process_use_secondary_output: bool,
    #[serde(default = "default_post_process_use_local_candidate_when_online_asr")]
    pub post_process_use_local_candidate_when_online_asr: bool,
    #[serde(default)]
    pub post_process_secondary_model_id: Option<String>,
    #[serde(default = "default_post_process_provider_id")]
    pub post_process_provider_id: String,
    #[serde(default = "default_post_process_providers")]
    pub post_process_providers: Vec<PostProcessProvider>,
    #[serde(default = "default_post_process_api_keys")]
    pub post_process_api_keys: HashMap<String, String>,
    #[serde(default = "default_post_process_models")]
    pub post_process_models: HashMap<String, String>,
    #[serde(default = "default_post_process_prompts")]
    pub post_process_prompts: Vec<LLMPrompt>,
    #[serde(default)]
    pub post_process_selected_prompt_id: Option<String>,
    #[serde(default)]
    pub post_process_intent_model_id: Option<String>,
    #[serde(default)]
    pub cached_models: Vec<CachedModel>,
    #[serde(default)]
    pub online_asr_enabled: bool,
    #[serde(default)]
    pub selected_asr_model_id: Option<String>,
    #[serde(default)]
    pub selected_prompt_model_id: Option<String>,
    #[serde(default)]
    pub mute_while_recording: bool,
    #[serde(default)]
    pub append_trailing_space: bool,
    #[serde(default = "default_sense_voice_use_itn")]
    pub sense_voice_use_itn: bool,
    #[serde(default = "default_punctuation_enabled")]
    pub punctuation_enabled: bool,
    #[serde(default = "default_punctuation_model")]
    pub punctuation_model: String,
    #[serde(default = "default_favorite_transcription_models")]
    pub favorite_transcription_models: Vec<String>,
    #[serde(default = "default_offline_vad_force_interval_ms")]
    pub offline_vad_force_interval_ms: u64,
    #[serde(default = "default_offline_vad_force_window_seconds")]
    pub offline_vad_force_window_seconds: u64,
    /// Enable LLM-based confidence checking for transcriptions
    #[serde(default = "default_confidence_check_enabled")]
    pub confidence_check_enabled: bool,
    /// Confidence threshold (0-100). Below this threshold, user review is required.
    #[serde(default = "default_confidence_threshold")]
    pub confidence_threshold: u8,
    /// Application-specific review policies (App Bundle ID or Process Name -> Policy)
    #[serde(default)]
    pub app_review_policies: HashMap<String, AppReviewPolicy>,
    #[serde(default)]
    pub app_profiles: Vec<AppProfile>,
    #[serde(default)]
    pub app_to_profile: HashMap<String, String>,
    #[serde(default = "default_post_process_context_enabled")]
    pub post_process_context_enabled: bool,
    #[serde(default = "default_post_process_context_limit")]
    pub post_process_context_limit: u8,
}

fn default_model() -> String {
    "".to_string()
}

fn default_app_language() -> String {
    "en".to_string()
}

fn default_always_on_microphone() -> bool {
    false
}

fn default_translate_to_english() -> bool {
    false
}

fn default_start_hidden() -> bool {
    false
}

fn default_autostart_enabled() -> bool {
    false
}

fn default_update_checks_enabled() -> bool {
    true
}

fn default_onboarding_completed() -> bool {
    false
}

fn default_selected_language() -> String {
    "auto".to_string()
}

fn default_overlay_position() -> OverlayPosition {
    #[cfg(target_os = "linux")]
    return OverlayPosition::None;
    #[cfg(not(target_os = "linux"))]
    return OverlayPosition::FollowCursor;
}

fn default_debug_mode() -> bool {
    false
}

fn default_log_level() -> LogLevel {
    LogLevel::Debug
}

fn default_word_correction_threshold() -> f64 {
    0.18
}

fn default_history_limit() -> usize {
    5
}

fn default_recording_retention_period() -> RecordingRetentionPeriod {
    RecordingRetentionPeriod::PreserveLimit
}

fn default_audio_feedback_volume() -> f32 {
    1.0
}

fn default_sound_theme() -> SoundTheme {
    SoundTheme::Marimba
}

fn default_post_process_enabled() -> bool {
    false
}

fn default_post_process_use_secondary_output() -> bool {
    false
}

fn default_post_process_use_local_candidate_when_online_asr() -> bool {
    false
}

fn default_post_process_provider_id() -> String {
    "openai".to_string()
}

fn default_post_process_providers() -> Vec<PostProcessProvider> {
    let mut providers = vec![
        PostProcessProvider {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
        },
        PostProcessProvider {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
        },
        PostProcessProvider {
            id: "anthropic".to_string(),
            label: "Anthropic".to_string(),
            base_url: "https://api.anthropic.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
        },
        PostProcessProvider {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            allow_base_url_edit: true,
            models_endpoint: Some("/models".to_string()),
        },
        PostProcessProvider {
            id: "iflow".to_string(),
            label: "iflow".to_string(),
            base_url: "https://apis.iflow.cn/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
        },
        PostProcessProvider {
            id: "gitee".to_string(),
            label: "Gitee".to_string(),
            base_url: "https://ai.gitee.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
        },
    ];

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        if crate::apple_intelligence::check_apple_intelligence_availability() {
            providers.push(PostProcessProvider {
                id: APPLE_INTELLIGENCE_PROVIDER_ID.to_string(),
                label: "Apple Intelligence".to_string(),
                base_url: "apple-intelligence://local".to_string(),
                allow_base_url_edit: false,
                models_endpoint: None,
            });
        }
    }

    providers
}

fn default_post_process_api_keys() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(provider.id, String::new());
    }
    map
}

fn default_model_for_provider(provider_id: &str) -> String {
    if provider_id == APPLE_INTELLIGENCE_PROVIDER_ID {
        return APPLE_INTELLIGENCE_DEFAULT_MODEL_ID.to_string();
    }
    String::new()
}

fn default_post_process_models() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(
            provider.id.clone(),
            default_model_for_provider(&provider.id),
        );
    }
    map
}

fn default_sense_voice_use_itn() -> bool {
    true
}

fn default_punctuation_enabled() -> bool {
    false
}

fn default_punctuation_model() -> String {
    "punct-zh-en-ct-transformer-2024-04-12-int8".to_string()
}

fn default_favorite_transcription_models() -> Vec<String> {
    Vec::new()
}

fn default_offline_vad_force_interval_ms() -> u64 {
    2000
}

fn default_offline_vad_force_window_seconds() -> u64 {
    30
}

fn default_confidence_check_enabled() -> bool {
    false
}

fn default_confidence_threshold() -> u8 {
    20
}

fn default_post_process_context_enabled() -> bool {
    false
}

fn default_post_process_context_limit() -> u8 {
    3
}

fn default_post_process_prompts() -> Vec<LLMPrompt> {
    vec![
        LLMPrompt {
            id: "default_improve_transcriptions".to_string(),
            name: "Improve Transcriptions".to_string(),
            description: "Clean and improve transcription text. Basic text cleaning.".to_string(),
            instructions: "Clean this transcript:\n1. Fix spelling, capitalization, and punctuation errors\n2. Convert number words to digits (twenty-five → 25, ten percent → 10%, five dollars → $5)\n3. Replace spoken punctuation with symbols (period → ., comma → ,, question mark → ?)\n4. Remove filler words (um, uh, like as filler)\n5. Keep the language in the original version (if it was french, keep it in french for example)\n\n用户自定义参考词汇（如果 ASR 识别出的词发音或拼写和 these 词相近，请优先修正为这些词）：\n${hot_words}\n\nPreserve exact meaning and word order. Do not paraphrase or reorder content.\n\nReturn only the cleaned transcript.\n\nTranscript:\n${output}".to_string(),

            model_id: None,
            aliases: None,
            icon: Some("IconWand".to_string()),
            skill_type: SkillType::Text,
            source: SkillSource::Builtin,
            compliance_check_enabled: false,
            compliance_threshold: Some(20),
            output_mode: Default::default(),
            enabled: true,
            customized: false,
            file_path: None,
        },
        LLMPrompt {
            id: "system_default_correction".to_string(),
            name: "默认润色".to_string(),
            description: "润色和优化文本表达。当用户说\"润色\"、\"优化\"、\"清理\"时使用。这是默认 Skill。".to_string(),
            instructions: "# ASR 文本清理与质量评估专家\n\n你是一位专注于语音识别（ASR）后处理的自然语言处理专家，擅长对转录文本进行高保真清理、语言润色与质量评估。你的工作严格遵循两阶段流程，确保输出文本在保持原始语义和表达习惯的前提下，达到出版级可读性与准确性。\n\n## 背景说明\n\n系统将提供以下输入变量供你参考：\n- `${output}`：语音转录的最终文本（已去除命令前缀和别名），作为主要处理依据。\n- `${streaming_output}`：实时转录过程中产生的中间文本，用于辅助上下文理解与歧义消解。\n\n> **注意**：你应优先以 `${output}` 为主，必要时结合 `${streaming_output}` 提升识别鲁棒性，尤其在处理中英混杂、专业术语或同音词场景时。\n\n## 任务流程\n\n### 阶段一：文本清理与润色\n\n基于输入文本，执行以下操作，生成自然、清晰、结构完整的最终文本：\n\n- **保留原始语言混合习惯**  \n  不翻译英文内容，维持用户原有的中英混用风格（如“这个 bug 很 critical”）。\n\n- **修正基础语言问题**  \n  - 删除无意义的填充词（如孤立的“嗯”、“啊”、“呃”）。\n  - 消除不合理叠词（如“你好啊啊” → “你好啊”）。\n  - 修正明显语病、重复、拼写错误及标点缺失；在缺失处合理补全中文标点。\n\n- **规范格式细节**  \n  中文与英文/数字之间必须保留一个空格，例如：  \n  `第1个question是xxx` → `第 1 个 question 是 xxx`\n\n- **优化长句可读性**  \n  对超过 40 字且逻辑复杂的句子，在语义自然断点处插入换行符（`\\n`），提升阅读流畅度。\n\n- **语义保真原则**  \n  所有修改必须基于上下文，不得改变原意或引入主观解读。\n\n### 阶段二：质量评估（仅基于阶段一输出）\n\n仅针对阶段一生成的最终文本，进行整体质量判断：\n\n检查是否存在以下问题（无需逐字标注，仅用于综合评分）：\n- 含糊、无意义或疑似乱码的词语\n- 语法错误或语句不通顺\n- 明显的 ASR 误识别（如同音字、近音词错误）\n- 语句片段化或逻辑不完整\n- 英文拼写异常或识别错误\n\n## 输出规范\n\n严格按以下 JSON 格式输出，**禁止任何额外文本、解释 or Markdown**：\n\n```json\n{\n  \"text\": \"阶段一生成的最终清理文本\",\n  \"confidence\": 0-100 的整数,\n  \"reason\": \"若存在明显问题，用一句话描述；否则为空字符串\"\n}\n```\n\n### 评分规则\n- `confidence`：对最终文本整体准确率的置信度估计（0–100 整数）。\n- `reason`：**仅当文本仍存在显著问题时填写**，且必须聚焦于最终文本本身的问题，不得提及修改过程、原始输入或推理逻辑。\n- 若文本通顺、准确、无歧义，则 `reason` 必须为 `\"\"`。".to_string(),
            model_id: None,
            aliases: Some("润色,优化,清理".to_string()),
            icon: Some("IconShieldCheck".to_string()),
            skill_type: SkillType::Text,
            source: SkillSource::Builtin,
            compliance_check_enabled: true,
            compliance_threshold: Some(20),
            output_mode: SkillOutputMode::Polish,
            enabled: true,
            customized: false,
            file_path: None,
        },
        LLMPrompt {
            id: "system_default_ai_chat".to_string(),
            name: "AI 问答".to_string(),
            description: "智能问答和通用对话。当用户提问或寻求帮助时使用。".to_string(),
            instructions: "# 意图驱动的文本操作专家\n\n## 角色\n你是一位精通自然语言理解与指令执行的语义分析专家，擅长从用户语音输入中精准识别意图，并据此对指定文本执行结构化操作。\n\n## 背景\n- 用户通过语音输入一段指令（`${raw_input}`），其中隐含对某段选中文本（`${select}`）的操作意图。\n- 你的任务是解析该意图，并对 `${select}` 执行相应处理。\n- 可参考上下文（`${context}`）和热词（`${hot_words}`）以提升意图识别准确性。\n\n## 任务\n1. **意图识别**：深入分析 `${raw_input}` 中表达的核心意图（如改写、摘要、翻译、格式化、纠错等）。\n2. **文本操作**：基于识别出的意图，对 `${select}` 执行精确、一致且符合用户预期的操作。\n3. **结果生成**：输出结构清晰、仅包含必要信息的响应。\n\n## 输出要求\n- 严格使用以下格式输出，不得添加额外说明或解释：\n原文：\n```text\n[用户意图]\n```\n结果：\n```text\n[根据意图执行后的结果]\n```\n- 结果必须忠实反映 `${raw_input}` 的指令意图，语言简洁、专业。\n- 禁止引入未在 `${raw_input}` 中暗示的操作；若意图模糊，优先保持原文不变并标注“[意图不明确，保留原文]”。\n- 输出语言应与 `${select}` 保持一致。".to_string(),
            model_id: None,
            aliases: Some("问问,帮我,帮我写,请问".to_string()),
            icon: Some("IconMessageSparkle".to_string()),
            skill_type: SkillType::Text,
            source: SkillSource::Builtin,
            compliance_check_enabled: false,
            compliance_threshold: Some(20),
            output_mode: SkillOutputMode::Chat,
            enabled: true,
            customized: false,
            file_path: None,
        },
        // Preset: Translation
        LLMPrompt {
            id: "system_preset_translate".to_string(),
            name: "翻译".to_string(),
            description: "将文本翻译成目标语言。当用户说\"翻译\"、\"译成\"、\"translate\"时使用。".to_string(),
            instructions: r#"# 智能翻译专家

你是一位专业翻译，擅长多语言互译。

## 输入
- `${output}`：需要翻译的文本
- `${raw_input}`：用户原始指令（可能包含目标语言信息）

## 任务
1. 分析用户指令确定目标语言（如未指定，中文译英文、英文译中文）
2. 执行高质量翻译

## 翻译原则
- 保持原文的语气、风格和专业术语
- 代码、变量名、专有名词保持原样
- 使用自然流畅的目标语言表达

## 输出
仅输出翻译结果，不要任何解释或额外内容。"#.to_string(),
            model_id: None,
            aliases: Some("翻译,译成,translate,翻成".to_string()),
            icon: Some("IconLanguage".to_string()),
            skill_type: SkillType::Text,
            source: SkillSource::Builtin,
            compliance_check_enabled: false,
            compliance_threshold: Some(20),
            output_mode: SkillOutputMode::Chat,
            enabled: true,
            customized: false,
            file_path: None,
        },
        // Preset: Summary
        LLMPrompt {
            id: "system_preset_summary".to_string(),
            name: "总结".to_string(),
            description: "总结和提炼文本要点。当用户说\"总结\"、\"概括\"、\"摘要\"时使用。".to_string(),
            instructions: r#"# 文本总结专家

你是一位精通信息提炼的总结专家。

## 输入
- `${select}`：需要总结的文本（选中内容）
- `${output}`：用户的额外指令

## 任务
对提供的文本进行精炼总结，提取核心要点。

## 总结原则
- 保留关键信息，去除冗余内容
- 使用简洁、逻辑清晰的语言
- 按重要性排序列出要点
- 保持客观中立，不添加个人观点

## 输出格式
**核心要点：**
- [要点1]
- [要点2]
- [要点3]

**简述：**
[1-2句话概括全文主旨]"#.to_string(),
            model_id: None,
            aliases: Some("总结,概括,摘要,summarize".to_string()),
            icon: Some("IconListDetails".to_string()),
            skill_type: SkillType::Text,
            source: SkillSource::Builtin,
            compliance_check_enabled: false,
            compliance_threshold: Some(20),
            output_mode: SkillOutputMode::Chat,
            enabled: true,
            customized: false,
            file_path: None,
        }
    ]
}

fn ensure_post_process_defaults(settings: &mut AppSettings) -> bool {
    let mut changed = false;
    for provider in default_post_process_providers() {
        if settings
            .post_process_providers
            .iter()
            .all(|existing| existing.id != provider.id)
        {
            settings.post_process_providers.push(provider.clone());
            changed = true;
        }

        if !settings.post_process_api_keys.contains_key(&provider.id) {
            settings
                .post_process_api_keys
                .insert(provider.id.clone(), String::new());
            changed = true;
        }

        let default_model = default_model_for_provider(&provider.id);
        match settings.post_process_models.get_mut(&provider.id) {
            Some(existing) => {
                if existing.is_empty() && !default_model.is_empty() {
                    *existing = default_model.clone();
                    changed = true;
                }
            }
            None => {
                settings
                    .post_process_models
                    .insert(provider.id.clone(), default_model);
                changed = true;
            }
        }
    }

    changed
}

pub const SETTINGS_STORE_PATH: &str = "settings_store.json";

pub fn get_default_settings() -> AppSettings {
    #[cfg(target_os = "windows")]
    let default_shortcut = "ctrl+space";
    #[cfg(target_os = "macos")]
    let default_shortcut = "option+space";
    #[cfg(target_os = "linux")]
    let default_shortcut = "ctrl+space";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_shortcut = "alt+space";

    let mut bindings = HashMap::new();
    bindings.insert(
        "transcribe".to_string(),
        ShortcutBinding {
            id: "transcribe".to_string(),
            name: "Transcribe".to_string(),
            description: "Converts your speech into text.".to_string(),
            default_binding: default_shortcut.to_string(),
            current_binding: default_shortcut.to_string(),
        },
    );
    bindings.insert(
        "cancel".to_string(),
        ShortcutBinding {
            id: "cancel".to_string(),
            name: "Cancel".to_string(),
            description: "Cancels the current recording.".to_string(),
            default_binding: "escape".to_string(),
            current_binding: "escape".to_string(),
        },
    );
    bindings.insert(
        "open_settings".to_string(),
        ShortcutBinding {
            id: "open_settings".to_string(),
            name: "Open Settings".to_string(),
            description: "Opens the settings window.".to_string(),
            default_binding: if cfg!(target_os = "macos") {
                "command+option+s".to_string()
            } else {
                "ctrl+alt+s".to_string()
            },
            current_binding: if cfg!(target_os = "macos") {
                "command+option+s".to_string()
            } else {
                "ctrl+alt+s".to_string()
            },
        },
    );
    bindings.insert(
        "paste_first_entry".to_string(),
        ShortcutBinding {
            id: "paste_first_entry".to_string(),
            name: "Paste First Entry".to_string(),
            description: "Pastes the first history entry to the active window.".to_string(),
            default_binding: "ctrl+shift+v".to_string(),
            current_binding: "ctrl+shift+v".to_string(),
        },
    );
    bindings.insert(
        "invoke_skill".to_string(),
        ShortcutBinding {
            id: "invoke_skill".to_string(),
            name: "Invoke Skill".to_string(),
            description: "Starts recording in Skill mode with intelligent intent routing."
                .to_string(),
            default_binding: if cfg!(target_os = "macos") {
                "command+shift+space".to_string()
            } else {
                "ctrl+shift+space".to_string()
            },
            current_binding: if cfg!(target_os = "macos") {
                "command+shift+space".to_string()
            } else {
                "ctrl+shift+space".to_string()
            },
        },
    );

    AppSettings {
        bindings,
        app_language: default_app_language(),
        push_to_talk: false,
        audio_feedback: true,
        audio_feedback_volume: default_audio_feedback_volume(),
        sound_theme: default_sound_theme(),
        start_hidden: default_start_hidden(),
        autostart_enabled: default_autostart_enabled(),
        update_checks_enabled: default_update_checks_enabled(),
        onboarding_completed: default_onboarding_completed(),
        selected_model: "".to_string(),
        always_on_microphone: false,
        selected_microphone: None,
        clamshell_microphone: None,
        selected_output_device: None,
        translate_to_english: false,
        selected_language: "auto".to_string(),
        overlay_position: default_overlay_position(),
        debug_mode: false,
        log_level: default_log_level(),
        custom_words: Vec::new(),
        model_unload_timeout: ModelUnloadTimeout::Never,
        word_correction_threshold: default_word_correction_threshold(),
        history_limit: default_history_limit(),
        recording_retention_period: default_recording_retention_period(),
        paste_method: PasteMethod::default(),
        clipboard_handling: ClipboardHandling::default(),
        post_process_enabled: default_post_process_enabled(),
        post_process_use_secondary_output: default_post_process_use_secondary_output(),
        post_process_use_local_candidate_when_online_asr:
            default_post_process_use_local_candidate_when_online_asr(),
        post_process_secondary_model_id: None,
        post_process_provider_id: default_post_process_provider_id(),
        post_process_providers: default_post_process_providers(),
        post_process_api_keys: default_post_process_api_keys(),
        post_process_models: default_post_process_models(),
        post_process_prompts: default_post_process_prompts(),
        post_process_selected_prompt_id: None,
        post_process_intent_model_id: None,
        cached_models: Vec::new(),
        online_asr_enabled: false,
        selected_asr_model_id: None,
        selected_prompt_model_id: None,
        mute_while_recording: false,
        append_trailing_space: false,
        sense_voice_use_itn: default_sense_voice_use_itn(),
        punctuation_enabled: default_punctuation_enabled(),
        punctuation_model: default_punctuation_model(),
        favorite_transcription_models: default_favorite_transcription_models(),
        offline_vad_force_interval_ms: default_offline_vad_force_interval_ms(),
        offline_vad_force_window_seconds: default_offline_vad_force_window_seconds(),
        confidence_check_enabled: default_confidence_check_enabled(),
        confidence_threshold: default_confidence_threshold(),
        app_review_policies: HashMap::new(),
        app_profiles: Vec::new(),
        app_to_profile: HashMap::new(),
        post_process_context_enabled: default_post_process_context_enabled(),
        post_process_context_limit: default_post_process_context_limit(),
    }
}

impl AppSettings {
    pub fn active_post_process_provider(&self) -> Option<&PostProcessProvider> {
        self.post_process_providers
            .iter()
            .find(|provider| provider.id == self.post_process_provider_id)
    }

    pub fn post_process_provider(&self, provider_id: &str) -> Option<&PostProcessProvider> {
        self.post_process_providers
            .iter()
            .find(|provider| provider.id == provider_id)
    }

    pub fn post_process_provider_mut(
        &mut self,
        provider_id: &str,
    ) -> Option<&mut PostProcessProvider> {
        self.post_process_providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
    }
}

pub fn load_or_create_app_settings(app: &AppHandle) -> AppSettings {
    // Initialize store
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        // Parse the entire settings object
        match serde_json::from_value::<AppSettings>(settings_value.clone()) {
            Ok(mut settings) => {
                debug!("Found existing settings: {:?}", settings);
                let default_settings = get_default_settings();
                let mut updated = false;

                // Merge default bindings into existing settings
                for (key, value) in default_settings.bindings {
                    if !settings.bindings.contains_key(&key) {
                        debug!("Adding missing binding: {}", key);
                        settings.bindings.insert(key, value);
                        updated = true;
                    }
                }

                if updated {
                    debug!("Settings updated with new bindings");
                    store.set("settings", serde_json::to_value(&settings).unwrap());
                }

                settings
            }
            Err(e) => {
                warn!("Failed to parse settings: {}", e);

                // Backup the original settings before overwriting
                if let Ok(backup_json) = serde_json::to_string_pretty(&settings_value) {
                    if let Some(app_data_dir) = app.path().app_data_dir().ok() {
                        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
                        let backup_path =
                            app_data_dir.join(format!("settings_backup_{}.json", timestamp));
                        if let Err(backup_err) = std::fs::write(&backup_path, &backup_json) {
                            warn!(
                                "Failed to backup settings to {:?}: {}",
                                backup_path, backup_err
                            );
                        } else {
                            warn!("Settings backed up to {:?} before reset", backup_path);
                        }
                    }
                }

                // Fall back to default settings if parsing fails
                let default_settings = get_default_settings();
                store.set("settings", serde_json::to_value(&default_settings).unwrap());
                default_settings
            }
        }
    } else {
        let default_settings = get_default_settings();
        store.set("settings", serde_json::to_value(&default_settings).unwrap());
        default_settings
    };

    if ensure_post_process_defaults(&mut settings) {
        store.set("settings", serde_json::to_value(&settings).unwrap());
    }

    // Migration: Convert app_review_policies to app_profiles
    if !settings.app_review_policies.is_empty() {
        debug!("Migrating app_review_policies to app_profiles");
        for (app_id, policy) in settings.app_review_policies.clone() {
            if !settings.app_to_profile.contains_key(&app_id) {
                let profile_id = format!("profile_{}", app_id.replace(' ', "_").to_lowercase());
                if !settings.app_profiles.iter().any(|p| p.id == profile_id) {
                    settings.app_profiles.push(AppProfile {
                        id: profile_id.clone(),
                        name: app_id.clone(),
                        policy,
                        prompt_id: None,
                        icon: None,
                        rules: Vec::new(),
                    });
                }
                settings.app_to_profile.insert(app_id.clone(), profile_id);
            }
        }
        settings.app_review_policies.clear();
        store.set("settings", serde_json::to_value(&settings).unwrap());
        let _ = store.save();
    }

    settings
}

pub fn get_settings(app: &AppHandle) -> AppSettings {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        serde_json::from_value::<AppSettings>(settings_value).unwrap_or_else(|_| {
            let default_settings = get_default_settings();
            store.set("settings", serde_json::to_value(&default_settings).unwrap());
            default_settings
        })
    } else {
        let default_settings = get_default_settings();
        store.set("settings", serde_json::to_value(&default_settings).unwrap());
        default_settings
    };

    if ensure_post_process_defaults(&mut settings) {
        store.set("settings", serde_json::to_value(&settings).unwrap());
    }

    // Merge external skills from ~/.votype/skills/
    merge_external_skills(app, &mut settings);

    if settings.post_process_selected_prompt_id.is_none() {
        if let Some(first) = settings.post_process_prompts.first() {
            settings.post_process_selected_prompt_id = Some(first.id.clone());
            store.set("settings", serde_json::to_value(&settings).unwrap());
        }
    }

    settings
}

fn merge_external_skills(app: &AppHandle, settings: &mut AppSettings) {
    let skill_manager = crate::managers::skill::SkillManager::new(app);
    let external_skills = skill_manager.load_all_external_skills();

    for skill in external_skills {
        // Check if already exists in the list
        if let Some(pos) = settings
            .post_process_prompts
            .iter()
            .position(|p| p.id == skill.id)
        {
            // If it's the SAME source (external), update it with newest content from disk.
            // If the user modified a built-in skill or saved an external one to JSON store,
            // we might want to decide which one wins.
            // For now, external file-based skills always override the memory/store version
            // if they have the same ID, to allow "live" editing of SKILL.md.
            settings.post_process_prompts[pos] = skill;
        } else {
            settings.post_process_prompts.push(skill);
        }
    }
}

pub fn write_settings(app: &AppHandle, settings: AppSettings) {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    store.set("settings", serde_json::to_value(&settings).unwrap());
    if let Err(e) = store.save() {
        log::error!("Failed to save settings to disk: {}", e);
    }
}

pub fn get_bindings(app: &AppHandle) -> HashMap<String, ShortcutBinding> {
    let settings = get_settings(app);

    settings.bindings
}

pub fn get_stored_binding(app: &AppHandle, id: &str) -> ShortcutBinding {
    let bindings = get_bindings(app);

    let binding = bindings.get(id).unwrap().clone();

    binding
}

pub fn get_history_limit(app: &AppHandle) -> usize {
    let settings = get_settings(app);
    settings.history_limit
}

pub fn get_recording_retention_period(app: &AppHandle) -> RecordingRetentionPeriod {
    let settings = get_settings(app);
    settings.recording_retention_period
}
