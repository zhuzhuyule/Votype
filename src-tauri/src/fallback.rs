use serde::{Deserialize, Serialize};
use specta::Type;
use std::future::Future;
use std::time::Duration;

pub const STAGGERED_DELAY_MS: u64 = 2000;

/// Strategy for how fallback models are invoked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ModelChainStrategy {
    /// Try primary first, then fallback on failure.
    Serial,
    /// Start primary, launch fallback after a delay if primary hasn't responded.
    Staggered,
    /// Launch all models concurrently, take first success.
    Race,
}

impl Default for ModelChainStrategy {
    fn default() -> Self {
        Self::Serial
    }
}

/// A model selection with optional fallback.
///
/// Serializes as an object. Deserializes from either a plain string (legacy
/// format where settings stored bare model IDs) or a full object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ModelChain {
    pub primary_id: String,
    pub fallback_id: Option<String>,
    #[serde(default)]
    pub strategy: ModelChainStrategy,
}

impl ModelChain {
    pub fn primary_id(&self) -> &str {
        &self.primary_id
    }

    pub fn all_ids(&self) -> Vec<&str> {
        let mut ids = vec![self.primary_id.as_str()];
        if let Some(ref fallback) = self.fallback_id {
            ids.push(fallback.as_str());
        }
        ids
    }
}

impl<'de> Deserialize<'de> for ModelChain {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct ModelChainVisitor;

        impl<'de> serde::de::Visitor<'de> for ModelChainVisitor {
            type Value = ModelChain;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a model ID string or a ModelChain object")
            }

            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(ModelChain {
                    primary_id: v.to_owned(),
                    fallback_id: None,
                    strategy: ModelChainStrategy::Serial,
                })
            }

            fn visit_map<A>(self, map: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::MapAccess<'de>,
            {
                #[derive(Deserialize)]
                struct ModelChainInner {
                    primary_id: String,
                    fallback_id: Option<String>,
                    #[serde(default)]
                    strategy: ModelChainStrategy,
                }

                let inner = ModelChainInner::deserialize(
                    serde::de::value::MapAccessDeserializer::new(map),
                )?;
                Ok(ModelChain {
                    primary_id: inner.primary_id,
                    fallback_id: inner.fallback_id,
                    strategy: inner.strategy,
                })
            }
        }

        deserializer.deserialize_any(ModelChainVisitor)
    }
}

/// Result of executing a model chain, carrying the outcome and metadata about
/// which model actually produced the result.
#[derive(Debug, Clone)]
pub struct FallbackResult<R> {
    pub result: R,
    pub actual_model_id: String,
    pub is_fallback: bool,
    pub primary_error: Option<String>,
}

/// Execute a model chain with fallback behavior based on the configured strategy.
///
/// The `execute_fn` receives an owned model ID and returns a future that produces
/// a `Result<T, String>`. When no fallback is configured, the primary model is
/// executed directly and the result is returned as-is.
pub async fn execute_with_fallback<T, F, Fut>(
    chain: &ModelChain,
    execute_fn: F,
) -> FallbackResult<Result<T, String>>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, String>> + Send + 'static,
    T: Send + 'static,
{
    let primary_id = chain.primary_id.clone();

    // No fallback configured — just run primary.
    let fallback_id = match &chain.fallback_id {
        Some(id) => id.clone(),
        None => {
            let result = execute_fn(primary_id.clone()).await;
            return FallbackResult {
                result,
                actual_model_id: primary_id,
                is_fallback: false,
                primary_error: None,
            };
        }
    };

    match chain.strategy {
        ModelChainStrategy::Serial => execute_serial(primary_id, fallback_id, execute_fn).await,
        ModelChainStrategy::Race => execute_race(primary_id, fallback_id, execute_fn).await,
        ModelChainStrategy::Staggered => {
            execute_staggered(primary_id, fallback_id, execute_fn).await
        }
    }
}

async fn execute_serial<T, F, Fut>(
    primary_id: String,
    fallback_id: String,
    execute_fn: F,
) -> FallbackResult<Result<T, String>>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, String>> + Send + 'static,
    T: Send + 'static,
{
    let primary_result = execute_fn(primary_id.clone()).await;
    match primary_result {
        Ok(_) => FallbackResult {
            result: primary_result,
            actual_model_id: primary_id,
            is_fallback: false,
            primary_error: None,
        },
        Err(ref e) => {
            let primary_err = e.clone();
            log::warn!(
                "Primary model '{}' failed: {}. Trying fallback '{}'",
                primary_id,
                primary_err,
                fallback_id
            );
            let fallback_result = execute_fn(fallback_id.clone()).await;
            FallbackResult {
                result: fallback_result,
                actual_model_id: fallback_id,
                is_fallback: true,
                primary_error: Some(primary_err),
            }
        }
    }
}

async fn execute_race<T, F, Fut>(
    primary_id: String,
    fallback_id: String,
    execute_fn: F,
) -> FallbackResult<Result<T, String>>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, String>> + Send + 'static,
    T: Send + 'static,
{
    log::info!("Racing models '{}' and '{}'", primary_id, fallback_id);

    let mut primary_handle = tokio::spawn(execute_fn(primary_id.clone()));
    let mut fallback_handle = tokio::spawn(execute_fn(fallback_id.clone()));

    tokio::select! {
        p_res = &mut primary_handle => {
            let primary_result = p_res.expect("primary task panicked");
            if primary_result.is_ok() {
                return FallbackResult {
                    result: primary_result,
                    actual_model_id: primary_id,
                    is_fallback: false,
                    primary_error: None,
                };
            }
            let primary_err = primary_result.err().unwrap();
            log::warn!(
                "Primary model '{}' failed in race: {}. Waiting for fallback.",
                primary_id,
                primary_err
            );
            let fallback_result = fallback_handle.await.expect("fallback task panicked");
            FallbackResult {
                result: fallback_result,
                actual_model_id: fallback_id,
                is_fallback: true,
                primary_error: Some(primary_err),
            }
        }
        f_res = &mut fallback_handle => {
            let fallback_result = f_res.expect("fallback task panicked");
            if fallback_result.is_ok() {
                log::info!("Fallback model '{}' won the race", fallback_id);
                return FallbackResult {
                    result: fallback_result,
                    actual_model_id: fallback_id,
                    is_fallback: true,
                    primary_error: None,
                };
            }
            let fallback_err = fallback_result.err().unwrap();
            log::warn!(
                "Fallback model '{}' failed in race: {}. Waiting for primary.",
                fallback_id,
                fallback_err
            );
            let primary_result = primary_handle.await.expect("primary task panicked");
            FallbackResult {
                result: primary_result,
                actual_model_id: primary_id,
                is_fallback: false,
                primary_error: None,
            }
        }
    }
}

async fn execute_staggered<T, F, Fut>(
    primary_id: String,
    fallback_id: String,
    execute_fn: F,
) -> FallbackResult<Result<T, String>>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, String>> + Send + 'static,
    T: Send + 'static,
{
    let mut primary_handle = tokio::spawn(execute_fn(primary_id.clone()));

    // Wait for primary to finish OR the stagger delay to elapse.
    tokio::select! {
        p_res = &mut primary_handle => {
            let primary_result = p_res.expect("primary task panicked");
            if primary_result.is_ok() {
                return FallbackResult {
                    result: primary_result,
                    actual_model_id: primary_id,
                    is_fallback: false,
                    primary_error: None,
                };
            }
            // Primary failed before delay — start fallback directly.
            let primary_err = primary_result.err().unwrap();
            log::warn!(
                "Primary model '{}' failed before stagger delay: {}. Starting fallback '{}'",
                primary_id,
                primary_err,
                fallback_id
            );
            let fallback_result = execute_fn(fallback_id.clone()).await;
            FallbackResult {
                result: fallback_result,
                actual_model_id: fallback_id,
                is_fallback: true,
                primary_error: Some(primary_err),
            }
        }
        _ = tokio::time::sleep(Duration::from_millis(STAGGERED_DELAY_MS)) => {
            // Stagger delay elapsed — also start fallback and race both.
            log::info!(
                "Primary model '{}' not done after {}ms, starting fallback '{}'",
                primary_id,
                STAGGERED_DELAY_MS,
                fallback_id
            );
            let mut fallback_handle = tokio::spawn(execute_fn(fallback_id.clone()));

            tokio::select! {
                p_res = &mut primary_handle => {
                    let primary_result = p_res.expect("primary task panicked");
                    if primary_result.is_ok() {
                        return FallbackResult {
                            result: primary_result,
                            actual_model_id: primary_id,
                            is_fallback: false,
                            primary_error: None,
                        };
                    }
                    let primary_err = primary_result.err().unwrap();
                    log::warn!(
                        "Primary model '{}' failed in staggered race: {}. Waiting for fallback.",
                        primary_id,
                        primary_err
                    );
                    let fallback_result = fallback_handle.await.expect("fallback task panicked");
                    FallbackResult {
                        result: fallback_result,
                        actual_model_id: fallback_id,
                        is_fallback: true,
                        primary_error: Some(primary_err),
                    }
                }
                f_res = &mut fallback_handle => {
                    let fallback_result = f_res.expect("fallback task panicked");
                    if fallback_result.is_ok() {
                        log::info!("Fallback model '{}' won the staggered race", fallback_id);
                        return FallbackResult {
                            result: fallback_result,
                            actual_model_id: fallback_id,
                            is_fallback: true,
                            primary_error: None,
                        };
                    }
                    let fallback_err = fallback_result.err().unwrap();
                    log::warn!(
                        "Fallback model '{}' failed in staggered race: {}. Waiting for primary.",
                        fallback_id,
                        fallback_err
                    );
                    let primary_result = primary_handle.await.expect("primary task panicked");
                    FallbackResult {
                        result: primary_result,
                        actual_model_id: primary_id,
                        is_fallback: false,
                        primary_error: None,
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_from_string() {
        let chain: ModelChain = serde_json::from_str(r#""gpt-4o""#).unwrap();
        assert_eq!(chain.primary_id(), "gpt-4o");
        assert_eq!(chain.fallback_id, None);
        assert_eq!(chain.strategy, ModelChainStrategy::Serial);
    }

    #[test]
    fn deserialize_from_object_without_fallback() {
        let json = r#"{"primary_id": "gpt-4o"}"#;
        let chain: ModelChain = serde_json::from_str(json).unwrap();
        assert_eq!(chain.primary_id(), "gpt-4o");
        assert_eq!(chain.fallback_id, None);
        assert_eq!(chain.strategy, ModelChainStrategy::Serial);
    }

    #[test]
    fn deserialize_from_full_object() {
        let json = r#"{
            "primary_id": "gpt-4o",
            "fallback_id": "gpt-3.5-turbo",
            "strategy": "staggered"
        }"#;
        let chain: ModelChain = serde_json::from_str(json).unwrap();
        assert_eq!(chain.primary_id(), "gpt-4o");
        assert_eq!(chain.fallback_id.as_deref(), Some("gpt-3.5-turbo"));
        assert_eq!(chain.strategy, ModelChainStrategy::Staggered);
    }

    #[test]
    fn roundtrip_serialize() {
        let chain = ModelChain {
            primary_id: "claude-3".into(),
            fallback_id: Some("claude-2".into()),
            strategy: ModelChainStrategy::Race,
        };
        let json = serde_json::to_string(&chain).unwrap();
        let deserialized: ModelChain = serde_json::from_str(&json).unwrap();
        assert_eq!(chain, deserialized);
    }

    #[test]
    fn option_model_chain_null() {
        let value: Option<ModelChain> = serde_json::from_str("null").unwrap();
        assert!(value.is_none());
    }

    #[test]
    fn all_ids_with_fallback() {
        let chain = ModelChain {
            primary_id: "a".into(),
            fallback_id: Some("b".into()),
            strategy: ModelChainStrategy::Serial,
        };
        assert_eq!(chain.all_ids(), vec!["a", "b"]);
    }

    #[test]
    fn all_ids_without_fallback() {
        let chain = ModelChain {
            primary_id: "a".into(),
            fallback_id: None,
            strategy: ModelChainStrategy::Serial,
        };
        assert_eq!(chain.all_ids(), vec!["a"]);
    }

    // --- execute_with_fallback tests ---

    #[tokio::test]
    async fn serial_primary_succeeds() {
        let chain = ModelChain {
            primary_id: "primary".into(),
            fallback_id: Some("fallback".into()),
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            if model_id == "primary" {
                Ok("primary_ok".to_string())
            } else {
                panic!("fallback should not be called");
            }
        })
        .await;

        assert_eq!(result.result.unwrap(), "primary_ok");
        assert_eq!(result.actual_model_id, "primary");
        assert!(!result.is_fallback);
        assert!(result.primary_error.is_none());
    }

    #[tokio::test]
    async fn serial_primary_fails_fallback_succeeds() {
        let chain = ModelChain {
            primary_id: "primary".into(),
            fallback_id: Some("fallback".into()),
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            if model_id == "primary" {
                Err("primary_error".to_string())
            } else {
                Ok("fallback_ok".to_string())
            }
        })
        .await;

        assert_eq!(result.result.unwrap(), "fallback_ok");
        assert_eq!(result.actual_model_id, "fallback");
        assert!(result.is_fallback);
        assert_eq!(result.primary_error.as_deref(), Some("primary_error"));
    }

    #[tokio::test]
    async fn serial_both_fail() {
        let chain = ModelChain {
            primary_id: "primary".into(),
            fallback_id: Some("fallback".into()),
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            Err::<String, _>(format!("{}_error", model_id))
        })
        .await;

        assert_eq!(result.result.unwrap_err(), "fallback_error");
        assert_eq!(result.actual_model_id, "fallback");
        assert!(result.is_fallback);
        assert_eq!(result.primary_error.as_deref(), Some("primary_error"));
    }

    #[tokio::test]
    async fn serial_no_fallback_primary_fails() {
        let chain = ModelChain {
            primary_id: "primary".into(),
            fallback_id: None,
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |_model_id| async move {
            Err::<String, _>("primary_error".to_string())
        })
        .await;

        assert_eq!(result.result.unwrap_err(), "primary_error");
        assert_eq!(result.actual_model_id, "primary");
        assert!(!result.is_fallback);
        assert!(result.primary_error.is_none());
    }

    #[tokio::test]
    async fn race_fastest_wins() {
        let chain = ModelChain {
            primary_id: "slow_primary".into(),
            fallback_id: Some("fast_fallback".into()),
            strategy: ModelChainStrategy::Race,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            if model_id == "slow_primary" {
                tokio::time::sleep(Duration::from_secs(5)).await;
                Ok("slow_result".to_string())
            } else {
                // Fast fallback returns immediately.
                Ok("fast_result".to_string())
            }
        })
        .await;

        assert_eq!(result.result.unwrap(), "fast_result");
        assert_eq!(result.actual_model_id, "fast_fallback");
        assert!(result.is_fallback);
    }
}
