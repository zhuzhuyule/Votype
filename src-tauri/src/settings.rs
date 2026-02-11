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

/// Hotword category for semantic classification
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum HotwordCategory {
    /// Person names (colleagues, friends, public figures)
    #[default]
    Person,
    /// Technical terms, industry vocabulary
    Term,
    /// Product/brand names, company names
    Brand,
    /// Abbreviations like API, SDK, CEO
    Abbreviation,
}

/// Usage scenario for hotwords
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HotwordScenario {
    /// Work context (meetings, documents, code)
    Work,
    /// Casual conversation (chat, memos)
    Casual,
}

/// Hotword entry with classification metadata
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Hotword {
    pub id: i64,
    /// Possible misrecognized forms (can be multiple)
    pub originals: Vec<String>,
    /// Target correct form
    pub target: String,
    /// Semantic category
    pub category: HotwordCategory,
    /// Usage scenarios (can be multiple)
    pub scenarios: Vec<HotwordScenario>,
    /// Auto-inference confidence (0.0-1.0)
    pub confidence: f64,
    /// Whether user manually overrode the category
    pub user_override: bool,
    /// Usage statistics
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub false_positive_count: i64,
    pub created_at: i64,
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
    /// 是否为 Thinking 模式（深度推理）模型
    #[serde(default)]
    pub is_thinking_model: bool,
    /// 额外的请求参数（JSON 格式，会合并到 LLM 请求体中）
    /// 例如: {"extended_thinking": true, "thinking_budget_tokens": 10000}
    #[serde(default)]
    pub extra_params: Option<HashMap<String, serde_json::Value>>,
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModelUnloadTimeout {
    #[default]
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardHandling {
    #[default]
    DontModify,
    CopyToClipboard,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutoSubmitKey {
    #[default]
    Enter,
    CtrlEnter,
    CmdEnter,
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

impl Default for PasteMethod {
    fn default() -> Self {
        // Default to CtrlV for macOS and Windows, Direct for Linux
        #[cfg(target_os = "linux")]
        return PasteMethod::Direct;
        #[cfg(not(target_os = "linux"))]
        return PasteMethod::CtrlV;
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

    pub fn to_start_path(self) -> String {
        format!("resources/{}_start.wav", self.as_str())
    }

    pub fn to_stop_path(self) -> String {
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
    #[serde(default = "default_auto_submit")]
    pub auto_submit: bool,
    #[serde(default)]
    pub auto_submit_key: AutoSubmitKey,
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
    /// Expert mode enables advanced settings visibility
    #[serde(default)]
    pub expert_mode: bool,
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

fn default_paste_delay_ms() -> u64 {
    60
}

fn default_auto_submit() -> bool {
    false
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
            id: "system_default_correction".to_string(),
            name: "默认润色".to_string(),
            description: "润色和优化文本表达。这是默认 Skill。".to_string(),
            instructions: include_str!("../resources/skills/system_default_correction.md")
                .to_string(),
            model_id: None,
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
            description:
                "解释选中内容或回答问题。当用户说\"这是什么\"、\"帮我解释\"、\"帮我查询\"时触发。"
                    .to_string(),
            instructions: include_str!("../resources/skills/system_default_ai_chat.md").to_string(),
            model_id: None,
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
            description: "将文本翻译成目标语言。当用户说\"翻译\"、\"译成\"、\"translate\"时使用。"
                .to_string(),
            instructions: include_str!("../resources/skills/system_preset_translate.md")
                .to_string(),
            model_id: None,
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
            description: "总结和提炼文本要点。当用户说\"总结\"、\"概括\"、\"摘要\"时使用。"
                .to_string(),
            instructions: include_str!("../resources/skills/system_preset_summary.md").to_string(),
            model_id: None,
            icon: Some("IconListDetails".to_string()),
            skill_type: SkillType::Text,
            source: SkillSource::Builtin,
            compliance_check_enabled: false,
            compliance_threshold: Some(20),
            output_mode: SkillOutputMode::Chat,
            enabled: true,
            customized: false,
            file_path: None,
        },
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
        model_unload_timeout: ModelUnloadTimeout::Never,
        word_correction_threshold: default_word_correction_threshold(),
        history_limit: default_history_limit(),
        recording_retention_period: default_recording_retention_period(),
        paste_method: PasteMethod::default(),
        clipboard_handling: ClipboardHandling::default(),
        auto_submit: default_auto_submit(),
        auto_submit_key: AutoSubmitKey::default(),
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
        expert_mode: false,
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
                        settings.bindings.entry(key).or_insert(value);
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
                    if let Ok(app_data_dir) = app.path().app_data_dir() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_disable_auto_submit() {
        let settings = get_default_settings();
        assert!(!settings.auto_submit);
        assert_eq!(settings.auto_submit_key, AutoSubmitKey::Enter);
    }
}
