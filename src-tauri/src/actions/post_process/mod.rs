use serde::{Deserialize, Serialize};

// Submodules
mod core;
mod extensions;
mod manual;
mod pipeline;
pub(crate) mod prompt_builder;
pub(crate) mod reference_resolver;
pub(crate) mod routing;

// Re-export public functions
pub(crate) use core::{
    build_instruction_message, build_user_message, execute_llm_request, resolve_prompt_message_role,
};
pub use extensions::{maybe_convert_chinese_variant, multi_post_process_transcription};
pub use manual::post_process_text_with_prompt;
pub use pipeline::maybe_post_process_transcription;
pub use pipeline::unified_post_process;

/// Internal type used by core.rs and extensions.rs
#[derive(Debug, Deserialize)]
pub(super) struct LlmReviewResponse {
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RewriteChange {
    pub from: String,
    pub to: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct RewriteResponse {
    pub normalized_instruction: String,
    pub operation: String,
    pub rewritten_text: String,
    pub changes: Vec<RewriteChange>,
}

/// Response from LLM for skill routing intent recognition
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SkillRouteResponse {
    /// The skill_id to use, or "default" for default processing
    pub skill_id: String,
    /// Confidence score (0-100) of the routing decision
    #[serde(default)]
    pub confidence: Option<i32>,
    /// Input source: "select" (use selected text), "output" (use full transcription),
    /// "extract" (use extracted content)
    #[serde(default)]
    pub input_source: Option<String>,
    /// Extracted/refined content from user's speech (only when input_source is "extract")
    #[serde(default)]
    pub extracted_content: Option<String>,
}

/// Result from a single model in multi-model post-processing
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct MultiModelPostProcessResult {
    /// Unique identifier for this result (matches the item id)
    pub id: String,
    /// Display label (model name, e.g. "qwen3-max")
    pub label: String,
    /// Provider display name (e.g. "Groq", "OpenAI")
    pub provider_label: String,
    /// Processed text result
    pub text: String,
    /// Confidence score (0-100), None if not available
    pub confidence: Option<u8>,
    /// Processing time in milliseconds
    pub processing_time_ms: u64,
    /// Error message if failed
    pub error: Option<String>,
    /// Whether this result is ready
    pub ready: bool,
    /// Token count from API usage or estimated via tiktoken
    pub token_count: Option<i64>,
    /// Output speed in estimated tokens per second
    pub output_speed: Option<f64>,
}

/// Event emitted during multi-model post-processing progress
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct MultiModelProgressEvent {
    /// Total number of models
    pub total: usize,
    /// Number of completed models
    pub completed: usize,
    /// Results that have completed so far
    pub results: Vec<MultiModelPostProcessResult>,
    /// Whether all models have completed
    pub done: bool,
}

/// Decision output from the intent analysis model (Step 2 of unified pipeline).
#[derive(Debug, Clone)]
pub struct IntentDecision {
    /// What level of processing is needed
    pub action: routing::SmartAction,
    /// Whether hotword/terminology injection should be enabled for this text
    pub needs_hotword: bool,
    /// Detected primary language of the text (ISO 639-1: "zh", "en", etc.)
    pub language: Option<String>,
    /// Token count consumed by the intent model call
    pub token_count: Option<i64>,
    /// Model ID used for intent analysis
    pub model_id: String,
    /// Provider ID used for intent analysis
    pub provider_id: String,
    /// Duration of the intent LLM call in milliseconds
    pub duration_ms: u64,
}

/// Unified result from the post-processing pipeline.
/// `transcribe.rs` matches on this to handle UI (review window, paste, history).
#[derive(Debug, Clone)]
pub enum PipelineResult {
    /// Post-processing is disabled or skipped (skip marker, no prompt configured, etc.)
    Skipped,

    /// History cache hit — reuse previous result (Step 1)
    Cached {
        text: String,
        model: Option<String>,
        prompt_id: Option<String>,
    },

    /// Intent model determined no changes needed (Step 2: pass_through)
    PassThrough {
        text: String,
        intent_token_count: Option<i64>,
    },

    /// Single-model polish completed (Step 4, single path)
    SingleModel {
        text: Option<String>,
        model: Option<String>,
        prompt_id: Option<String>,
        token_count: Option<i64>,
        llm_call_count: Option<i64>,
        error: bool,
        error_message: Option<String>,
        /// Model ID used for the polish/rewrite call (for metrics logging)
        metrics_model_id: Option<String>,
        /// Provider ID used for the polish/rewrite call (for metrics logging)
        metrics_provider_id: Option<String>,
        /// Duration of the polish/rewrite LLM call in milliseconds
        metrics_duration_ms: Option<u64>,
        /// Estimated output tokens per second
        metrics_tokens_per_sec: Option<f64>,
    },

    /// Multi-model auto-pick: all results ready, caller picks best (race/lazy strategy)
    MultiModelAutoPick {
        candidates: Vec<MultiModelPostProcessResult>,
        /// The multi-model item configs used (needed for label lookup)
        multi_items: Vec<crate::settings::MultiModelPostProcessItem>,
        total_token_count: Option<i64>,
        llm_call_count: Option<i64>,
        /// Prompt ID used for all candidates
        prompt_id: Option<String>,
    },

    /// Multi-model manual: caller should show review window immediately, then start streaming.
    /// Pipeline returns before results are ready so the window can open instantly.
    MultiModelManual {
        /// The multi-model item configs (needed to build loading candidates and call multi_post_process)
        multi_items: Vec<crate::settings::MultiModelPostProcessItem>,
        intent_token_count: Option<i64>,
        /// Prompt ID used for all candidates
        prompt_id: Option<String>,
    },

    /// Skill confirmation is pending — UI waiting for user input
    PendingSkillConfirmation,
}
