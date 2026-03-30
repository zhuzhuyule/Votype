#[derive(Debug, thiserror::Error)]
pub enum VotypeError {
    #[error("Audio error: {0}")]
    Audio(String),
    #[error("Settings error: {0}")]
    Settings(String),
    #[error("LLM error: {0}")]
    Llm(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl From<VotypeError> for String {
    fn from(e: VotypeError) -> String {
        e.to_string()
    }
}
