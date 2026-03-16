use log::{debug, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_log::LogLevel;
use tauri_plugin_store::StoreExt;

static SETTINGS_VERSION: AtomicU64 = AtomicU64::new(0);
static CACHED_SETTINGS: Mutex<Option<(u64, AppSettings)>> = Mutex::new(None);

pub const APPLE_INTELLIGENCE_PROVIDER_ID: &str = "apple_intelligence";
pub const APPLE_INTELLIGENCE_DEFAULT_MODEL_ID: &str = "Apple Intelligence";
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct ShortcutBinding {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_binding: String,
    pub current_binding: String,
}

/// Skill type determines execution behavior
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "lowercase")]
pub enum SkillType {
    /// Text processing skill (polish, translate, etc.)
    #[default]
    Text,
    /// Action skill (open folder, query weather, etc.)
    Action,
    /// For compatibility with main branch
    Prompt,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum SkillOutputMode {
    /// Polish mode: ASR result -> AI refinement -> Insert. UI shows Diff.
    Polish,
    /// Chat mode: ASR result -> AI Q&A -> Preview. UI shows Markdown.
    Chat,
    /// Silent mode: No UI output (for Action skills)
    Silent,
    // Variants for main branch compatibility
    Replace,
    Append,
    Overlay,
}

impl Default for SkillOutputMode {
    fn default() -> Self {
        SkillOutputMode::Chat
    }
}

fn default_true() -> bool {
    true
}

impl Default for Skill {
    fn default() -> Self {
        Self {
            id: "".to_string(),
            name: "".to_string(),
            description: "".to_string(),
            instructions: "".to_string(),
            prompt: "".to_string(),
            model_id: None,
            icon: None,
            skill_type: SkillType::default(),
            source: SkillSource::default(),
            confidence_check_enabled: false,
            confidence_threshold: None,
            output_mode: SkillOutputMode::default(),
            enabled: true,
            customized: false,
            locked: false,
            file_path: None,
        }
    }
}

/// Skill source indicates where the skill was loaded from
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default, Type)]
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

/// Metadata for a hotword category (stored in DB)
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct HotwordCategoryMeta {
    pub id: String,
    pub label: String,
    pub color: String,
    pub icon: String,
    pub sort_order: i64,
    pub is_builtin: bool,
}

/// Usage scenario for hotwords
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum HotwordScenario {
    /// Work context (meetings, documents, code)
    Work,
    /// Casual conversation (chat, memos)
    Casual,
}

/// Hotword entry with classification metadata
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct Hotword {
    pub id: i64,
    /// Possible misrecognized forms (can be multiple)
    pub originals: Vec<String>,
    /// Target correct form
    pub target: String,
    /// Semantic category (e.g. "person", "term", "brand", "abbreviation", or custom)
    pub category: String,
    /// Usage scenarios (can be multiple)
    pub scenarios: Vec<HotwordScenario>,
    /// Whether user manually overrode the category
    pub user_override: bool,
    /// Usage statistics
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub false_positive_count: i64,
    pub created_at: i64,
    /// "active" (confirmed) or "suggested" (AI-suggested, pending user confirmation)
    #[serde(default = "default_hotword_status")]
    pub status: String,
    /// Source of the hotword: "manual", "auto_learned", "ai_extracted"
    #[serde(default = "default_hotword_source")]
    pub source: String,
}

fn default_hotword_status() -> String {
    "active".to_string()
}

fn default_hotword_source() -> String {
    "manual".to_string()
}

/// Backward compatibility: LLMPrompt is now an alias for Skill
pub type LLMPrompt = Skill;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Skill {
    pub id: String,
    pub name: String,
    /// Description for LLM intent recognition (Agent Skills compatible)
    #[serde(default)]
    pub description: String,
    pub instructions: String,
    pub prompt: String,
    pub model_id: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub skill_type: SkillType,
    #[serde(default)]
    pub source: SkillSource,
    #[serde(default, alias = "compliance_check_enabled")]
    pub confidence_check_enabled: bool,
    #[serde(default, alias = "compliance_threshold")]
    pub confidence_threshold: Option<u8>,
    #[serde(default)]
    pub output_mode: SkillOutputMode,
    /// Whether this skill is enabled (default: true)
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Whether this skill has been customized by user in settings
    /// If true, user's version takes priority over file-based version
    #[serde(default)]
    pub customized: bool,
    /// Whether this skill is locked (prevents editing/deletion)
    #[serde(default)]
    pub locked: bool,
    /// File path for external skills (user/imported source only)
    /// Skipped from serialization (runtime only)
    #[serde(skip)]
    pub file_path: Option<std::path::PathBuf>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct PostProcessProvider {
    pub id: String,
    pub label: String,
    pub base_url: String,
    #[serde(default)]
    pub allow_base_url_edit: bool,
    #[serde(default)]
    pub models_endpoint: Option<String>,
    #[serde(default)]
    pub supports_structured_output: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum ModelType {
    Text,
    Asr,
    Other,
}

/// Multi-model post-process configuration item
/// Uses cached_model_id and prompt_id to reference existing models and prompts
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct MultiModelPostProcessItem {
    /// Unique identifier for this item
    pub id: String,
    /// Reference to LLM provider id
    pub provider_id: String,
    /// Reference to LLM model id
    pub model_id: String,
    /// Reference to skill/prompt id
    pub prompt_id: String,
    /// Display name (optional, defaults to model name + prompt name)
    #[serde(default)]
    pub custom_label: Option<String>,
    /// Whether this item is enabled
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for MultiModelPostProcessItem {
    fn default() -> Self {
        let timestamp = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        Self {
            id: format!("mmpp_{}", timestamp),
            provider_id: String::new(),
            model_id: String::new(),
            prompt_id: String::new(),
            custom_label: None,
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
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
    /// LLM 指令消息角色（system / developer）
    #[serde(default)]
    pub prompt_message_role: PromptMessageRole,
    /// 额外的请求参数（JSON 格式，会合并到 LLM 请求体中）
    /// 例如: {"extended_thinking": true, "thinking_budget_tokens": 10000}
    #[serde(default)]
    pub extra_params: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "lowercase")]
pub enum PromptMessageRole {
    #[default]
    System,
    Developer,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    None,
    Top,
    Bottom,
    #[serde(rename = "follow")]
    FollowCursor,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum PasteMethod {
    CtrlV,
    Direct,
    None,
    ShiftInsert,
    CtrlShiftV,
    ExternalScript,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardHandling {
    #[default]
    DontModify,
    CopyToClipboard,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "snake_case")]
pub enum AutoSubmitKey {
    #[default]
    Enter,
    CtrlEnter,
    CmdEnter,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum RecordingRetentionPeriod {
    Never,
    PreserveLimit,
    Days3,
    Weeks2,
    Months3,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum AppReviewPolicy {
    /// Use global confidence threshold (default)
    Auto,
    /// Always show review window
    Always,
    /// Never show review window, direct insert
    Never,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum KeyboardImplementation {
    Tauri,
    HandyKeys,
}

impl Default for KeyboardImplementation {
    fn default() -> Self {
        // Default to HandyKeys only on macOS where it's well-tested.
        // Windows and Linux use Tauri by default (handy-keys not sufficiently tested yet).
        #[cfg(target_os = "macos")]
        return KeyboardImplementation::HandyKeys;
        #[cfg(not(target_os = "macos"))]
        return KeyboardImplementation::Tauri;
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
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

pub type PromptOutputMode = SkillOutputMode;

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct TitleRule {
    pub id: String,
    pub pattern: String,
    #[serde(default)]
    pub match_type: TitleMatchType,
    pub policy: AppReviewPolicy,
    pub prompt_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TypingTool {
    Auto,
    Wtype,
    Kwtype,
    Dotool,
    Ydotool,
    Xdotool,
}

impl Default for TypingTool {
    fn default() -> Self {
        TypingTool::Auto
    }
}

fn default_show_tray_icon() -> bool {
    true
}

/* still handy for composing the initial JSON in the store ------------- */
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
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
    #[specta(type = String)]
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
    pub builtin_prompt_resource_hashes: HashMap<String, String>,
    #[serde(default)]
    pub custom_words: Vec<String>,
    #[serde(default)]
    pub post_process_selected_prompt_id: Option<String>,
    #[serde(default)]
    pub post_process_intent_model_id: Option<String>,
    /// Enable multi-model parallel post-processing
    #[serde(default)]
    pub multi_model_post_process_enabled: bool,
    /// List of models to use for multi-model post-processing
    #[serde(default)]
    pub multi_model_post_process_items: Vec<MultiModelPostProcessItem>,
    /// Selected cached_model IDs for multi-model parallel post-processing (checkbox-based)
    #[serde(default)]
    pub multi_model_selected_ids: Vec<String>,
    /// Multi-model strategy: manual | race | lazy
    #[serde(default = "default_multi_model_strategy")]
    pub multi_model_strategy: String,
    /// Counts of manual candidate picks by cached_model_id
    #[serde(default)]
    pub multi_model_manual_pick_counts: HashMap<String, u32>,
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
    #[serde(default = "default_audio_input_auto_enhance")]
    pub audio_input_auto_enhance: bool,
    #[serde(default)]
    pub append_trailing_space: bool,
    #[serde(default = "default_punctuation_enabled")]
    pub punctuation_enabled: bool,
    #[serde(default = "default_punctuation_model")]
    pub punctuation_model: String,
    #[serde(default = "default_favorite_transcription_models")]
    pub favorite_transcription_models: Vec<String>,
    #[serde(default)]
    pub realtime_transcription_enabled: bool,
    #[serde(default = "default_offline_vad_force_interval_ms")]
    pub offline_vad_force_interval_ms: u64,
    #[serde(default = "default_offline_vad_force_window_seconds")]
    pub offline_vad_force_window_seconds: u64,
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
    #[serde(default = "default_post_process_streaming_output_enabled")]
    pub post_process_streaming_output_enabled: bool,
    #[serde(default = "default_post_process_hotword_injection_enabled")]
    pub post_process_hotword_injection_enabled: bool,
    /// Expert mode enables advanced settings visibility
    #[serde(default)]
    pub expert_mode: bool,
    #[serde(default)]
    pub experimental_enabled: bool,
    #[serde(default)]
    pub keyboard_implementation: KeyboardImplementation,
    #[serde(default = "default_show_tray_icon")]
    pub show_tray_icon: bool,
    #[serde(default = "default_paste_delay_ms")]
    pub paste_delay_ms: u64,
    #[serde(default)]
    pub typing_tool: TypingTool,
    #[serde(default)]
    pub external_script_path: Option<String>,
    /// Length routing: auto-select model based on text length
    #[serde(default)]
    pub length_routing_enabled: bool,
    #[serde(default = "default_length_routing_threshold")]
    pub length_routing_threshold: u32,
    #[serde(default)]
    pub length_routing_short_model_id: Option<String>,
    #[serde(default)]
    pub length_routing_long_model_id: Option<String>,
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

fn default_audio_input_auto_enhance() -> bool {
    true
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
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "anthropic".to_string(),
            label: "Anthropic".to_string(),
            base_url: "https://api.anthropic.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            allow_base_url_edit: true,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "iflow".to_string(),
            label: "iflow".to_string(),
            base_url: "https://apis.iflow.cn/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "gitee".to_string(),
            label: "Gitee".to_string(),
            base_url: "https://ai.gitee.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "zai".to_string(),
            label: "Z.AI".to_string(),
            base_url: "https://api.z.ai/api/paas/v4".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
    ];

    // On macOS ARM64, always include Apple Intelligence provider.
    // Availability is checked at runtime in core.rs when actually invoking it.
    // Calling check_apple_intelligence_availability() at startup can crash on macOS 26.x.
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        providers.push(PostProcessProvider {
            id: APPLE_INTELLIGENCE_PROVIDER_ID.to_string(),
            label: "Apple Intelligence".to_string(),
            base_url: "apple-intelligence://local".to_string(),
            allow_base_url_edit: false,
            models_endpoint: None,
            supports_structured_output: false,
        });
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

fn default_multi_model_strategy() -> String {
    "manual".to_string()
}

fn default_punctuation_model() -> String {
    "".to_string()
}

fn default_favorite_transcription_models() -> Vec<String> {
    Vec::new()
}

fn default_offline_vad_force_interval_ms() -> u64 {
    1000
}

fn default_offline_vad_force_window_seconds() -> u64 {
    30
}

fn default_post_process_context_enabled() -> bool {
    false
}

fn default_post_process_context_limit() -> u8 {
    3
}

fn default_post_process_streaming_output_enabled() -> bool {
    true
}

fn default_post_process_hotword_injection_enabled() -> bool {
    true
}

fn default_length_routing_threshold() -> u32 {
    100
}

fn default_post_process_prompts() -> Vec<LLMPrompt> {
    Vec::new()
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

        // Sync supports_structured_output for existing providers
        if let Some(existing) = settings
            .post_process_providers
            .iter_mut()
            .find(|p| p.id == provider.id)
        {
            if existing.supports_structured_output != provider.supports_structured_output {
                existing.supports_structured_output = provider.supports_structured_output;
                changed = true;
            }
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

    let original_len = settings.post_process_prompts.len();
    settings
        .post_process_prompts
        .retain(|prompt| prompt.source != SkillSource::Builtin);
    if settings.post_process_prompts.len() != original_len {
        changed = true;
    }

    if !settings.builtin_prompt_resource_hashes.is_empty() {
        settings.builtin_prompt_resource_hashes.clear();
        changed = true;
    }

    if settings
        .post_process_selected_prompt_id
        .as_ref()
        .is_some_and(|selected_id| {
            !settings
                .post_process_prompts
                .iter()
                .any(|prompt| &prompt.id == selected_id)
        })
    {
        settings.post_process_selected_prompt_id = None;
        changed = true;
    }

    changed
}

fn materialize_stored_user_prompts(app: &AppHandle, settings: &mut AppSettings) -> bool {
    let skill_manager = crate::managers::skill::SkillManager::new(app);
    let mut changed = false;

    for prompt in settings
        .post_process_prompts
        .iter()
        .filter(|prompt| prompt.source != SkillSource::Builtin)
        .cloned()
    {
        if skill_manager.find_skill_file_path(&prompt.id).is_some() {
            continue;
        }

        match skill_manager.create_skill_file(&prompt) {
            Ok(created) => {
                log::info!(
                    "Materialized stored prompt '{}' ({}) to file-backed user skill at {:?}",
                    created.name,
                    created.id,
                    created.file_path
                );
                changed = true;
            }
            Err(err) => {
                log::error!(
                    "Failed to materialize stored prompt '{}' ({}): {}",
                    prompt.name,
                    prompt.id,
                    err
                );
            }
        }
    }

    changed
}

fn normalize_app_review_policies(settings: &mut AppSettings) -> bool {
    let mut changed = false;

    for profile in &mut settings.app_profiles {
        if matches!(profile.policy, AppReviewPolicy::Auto) {
            profile.policy = AppReviewPolicy::Always;
            changed = true;
        }

        for rule in &mut profile.rules {
            if matches!(rule.policy, AppReviewPolicy::Auto) {
                rule.policy = AppReviewPolicy::Always;
                changed = true;
            }
        }
    }

    for policy in settings.app_review_policies.values_mut() {
        if matches!(*policy, AppReviewPolicy::Auto) {
            *policy = AppReviewPolicy::Always;
            changed = true;
        }
    }

    changed
}

fn normalize_offline_vad_force_interval(settings: &mut AppSettings) -> bool {
    if settings.offline_vad_force_interval_ms == 2000 {
        settings.offline_vad_force_interval_ms = default_offline_vad_force_interval_ms();
        return true;
    }

    false
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

    #[cfg(target_os = "windows")]
    let default_post_process_shortcut = "ctrl+shift+space";
    #[cfg(target_os = "macos")]
    let default_post_process_shortcut = "option+shift+space";
    #[cfg(target_os = "linux")]
    let default_post_process_shortcut = "ctrl+shift+space";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_post_process_shortcut = "alt+shift+space";

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
        "transcribe_with_post_process".to_string(),
        ShortcutBinding {
            id: "transcribe_with_post_process".to_string(),
            name: "Transcribe with Post-Processing".to_string(),
            description: "Converts your speech into text and applies AI post-processing."
                .to_string(),
            default_binding: default_post_process_shortcut.to_string(),
            current_binding: default_post_process_shortcut.to_string(),
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
        builtin_prompt_resource_hashes: HashMap::new(),
        post_process_selected_prompt_id: None,
        post_process_intent_model_id: None,
        multi_model_post_process_enabled: false,
        multi_model_post_process_items: Vec::new(),
        multi_model_selected_ids: Vec::new(),
        multi_model_strategy: default_multi_model_strategy(),
        multi_model_manual_pick_counts: HashMap::new(),
        cached_models: Vec::new(),
        online_asr_enabled: false,
        selected_asr_model_id: None,
        selected_prompt_model_id: None,
        mute_while_recording: false,
        audio_input_auto_enhance: default_audio_input_auto_enhance(),
        append_trailing_space: false,
        punctuation_enabled: default_punctuation_enabled(),
        punctuation_model: default_punctuation_model(),
        favorite_transcription_models: default_favorite_transcription_models(),
        realtime_transcription_enabled: false,
        offline_vad_force_interval_ms: default_offline_vad_force_interval_ms(),
        offline_vad_force_window_seconds: default_offline_vad_force_window_seconds(),
        app_review_policies: HashMap::new(),
        app_profiles: Vec::new(),
        app_to_profile: HashMap::new(),
        post_process_context_enabled: default_post_process_context_enabled(),
        post_process_context_limit: default_post_process_context_limit(),
        post_process_streaming_output_enabled: default_post_process_streaming_output_enabled(),
        post_process_hotword_injection_enabled: default_post_process_hotword_injection_enabled(),
        custom_words: Vec::new(),
        expert_mode: false,
        experimental_enabled: false,
        keyboard_implementation: KeyboardImplementation::default(),
        show_tray_icon: default_show_tray_icon(),
        paste_delay_ms: default_paste_delay_ms(),
        typing_tool: TypingTool::default(),
        external_script_path: None,
        length_routing_enabled: false,
        length_routing_threshold: default_length_routing_threshold(),
        length_routing_short_model_id: None,
        length_routing_long_model_id: None,
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

    #[allow(dead_code)]
    /// Get enabled multi-model post-process items
    pub fn enabled_multi_model_items(&self) -> Vec<&MultiModelPostProcessItem> {
        self.multi_model_post_process_items
            .iter()
            .filter(|item| item.enabled)
            .collect()
    }

    #[allow(dead_code)]
    /// Get cached model by ID
    pub fn get_cached_model(&self, model_id: &str) -> Option<&CachedModel> {
        self.cached_models.iter().find(|m| m.id == model_id)
    }

    /// Build MultiModelPostProcessItem list from multi_model_selected_ids.
    /// Uses cached_model info + current selected prompt to dynamically construct items.
    pub fn build_multi_model_items_from_selection(&self) -> Vec<MultiModelPostProcessItem> {
        let prompt_id = self.post_process_selected_prompt_id.clone().or_else(|| {
            self.post_process_prompts
                .first()
                .map(|prompt| prompt.id.clone())
        });

        let Some(prompt_id) = prompt_id else {
            return Vec::new();
        };

        self.multi_model_selected_ids
            .iter()
            .filter_map(|id| {
                let cm = self.get_cached_model(id)?;
                if cm.model_type != ModelType::Text {
                    return None;
                }
                Some(MultiModelPostProcessItem {
                    id: cm.id.clone(),
                    provider_id: cm.provider_id.clone(),
                    model_id: cm.model_id.clone(),
                    prompt_id: prompt_id.clone(),
                    custom_label: cm.custom_label.clone(),
                    enabled: true,
                })
            })
            .collect()
    }

    #[allow(dead_code)]
    /// Get prompt/skill by ID
    pub fn get_prompt(&self, prompt_id: &str) -> Option<&LLMPrompt> {
        self.post_process_prompts.iter().find(|p| p.id == prompt_id)
    }
}

fn store_set_settings(store: &tauri_plugin_store::Store<tauri::Wry>, settings: &AppSettings) {
    if let Ok(val) = serde_json::to_value(settings) {
        store.set("settings", val);
    } else {
        log::error!("Failed to serialize settings to JSON");
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
                    store_set_settings(&store, &settings);
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
                store_set_settings(&store, &default_settings);
                default_settings
            }
        }
    } else {
        let default_settings = get_default_settings();
        store_set_settings(&store, &default_settings);
        default_settings
    };

    if ensure_post_process_defaults(&mut settings) {
        store_set_settings(&store, &settings);
    }

    if materialize_stored_user_prompts(app, &mut settings) {
        merge_external_skills(app, &mut settings);
        store_set_settings(&store, &settings);
    }

    if normalize_app_review_policies(&mut settings) {
        store_set_settings(&store, &settings);
    }

    if normalize_offline_vad_force_interval(&mut settings) {
        store_set_settings(&store, &settings);
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
        store_set_settings(&store, &settings);
        let _ = store.save();
    }

    settings
}

pub fn get_settings(app: &AppHandle) -> AppSettings {
    let current_version = SETTINGS_VERSION.load(Ordering::Acquire);

    // Check cache
    if let Ok(cache) = CACHED_SETTINGS.lock() {
        if let Some((cached_version, ref cached_settings)) = *cache {
            if cached_version == current_version {
                return cached_settings.clone();
            }
        }
    }

    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        serde_json::from_value::<AppSettings>(settings_value).unwrap_or_else(|_| {
            let default_settings = get_default_settings();
            store_set_settings(&store, &default_settings);
            default_settings
        })
    } else {
        let default_settings = get_default_settings();
        store_set_settings(&store, &default_settings);
        default_settings
    };

    if ensure_post_process_defaults(&mut settings) {
        store_set_settings(&store, &settings);
    }

    if materialize_stored_user_prompts(app, &mut settings) {
        merge_external_skills(app, &mut settings);
        store_set_settings(&store, &settings);
    }

    if normalize_app_review_policies(&mut settings) {
        store_set_settings(&store, &settings);
    }

    if normalize_offline_vad_force_interval(&mut settings) {
        store_set_settings(&store, &settings);
    }

    // Merge external skills from ~/.votype/skills/
    merge_external_skills(app, &mut settings);

    if settings.post_process_selected_prompt_id.is_none() {
        if let Some(first) = settings.post_process_prompts.first() {
            settings.post_process_selected_prompt_id = Some(first.id.clone());
            store_set_settings(&store, &settings);
        }
    }

    // Update cache
    if let Ok(mut cache) = CACHED_SETTINGS.lock() {
        *cache = Some((current_version, settings.clone()));
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
    let mut settings = settings;
    normalize_app_review_policies(&mut settings);
    normalize_offline_vad_force_interval(&mut settings);

    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    store_set_settings(&store, &settings);
    if let Err(e) = store.save() {
        log::error!("Failed to save settings to disk: {}", e);
    }

    // Invalidate cache
    SETTINGS_VERSION.fetch_add(1, Ordering::Release);
}

pub fn get_bindings(app: &AppHandle) -> HashMap<String, ShortcutBinding> {
    let settings = get_settings(app);

    settings.bindings
}

pub fn get_stored_binding(app: &AppHandle, id: &str) -> Option<ShortcutBinding> {
    let bindings = get_bindings(app);
    bindings.get(id).cloned()
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
