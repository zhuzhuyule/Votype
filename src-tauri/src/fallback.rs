use serde::{Deserialize, Serialize};

/// Strategy for how fallback models are invoked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
}
