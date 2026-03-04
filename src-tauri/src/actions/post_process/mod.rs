use serde::{Deserialize, Serialize};

// Submodules
mod core;
mod extensions;
mod manual;
mod pipeline;
mod routing;

// Re-export public functions
pub use core::execute_llm_request;
pub use extensions::{maybe_convert_chinese_variant, multi_post_process_transcription};
pub use manual::post_process_text_with_prompt;
pub use pipeline::maybe_post_process_transcription;

/// Internal type used by core.rs and extensions.rs
#[derive(Debug, Deserialize)]
pub(super) struct LlmReviewResponse {
    pub text: Option<String>,
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
    /// Display label (model name + prompt name or custom)
    pub label: String,
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
