use crate::key_selector::KeySelector;
use crate::settings::AppSettings;
use std::collections::HashSet;
use std::future::Future;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttemptErrorKind {
    Http,
    Network,
    ClientInit,
    Parse,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttemptError {
    Retryable {
        status: Option<u16>,
        detail: String,
        kind: AttemptErrorKind,
    },
    Fatal {
        status: Option<u16>,
        detail: String,
        kind: AttemptErrorKind,
    },
}

pub type AttemptResult<T> = Result<T, AttemptError>;

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub struct ExecutionPlan {
    pub provider_id: String,
    pub cached_model_id: String,
    pub remote_model_id: String,
    pub max_attempts: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionOutcome<T> {
    Success(T),
    Exhausted {
        provider_id: String,
        attempts: usize,
        last_error: AttemptError,
    },
    Fatal {
        provider_id: String,
        detail: String,
        status: Option<u16>,
        kind: AttemptErrorKind,
    },
}

pub async fn execute_with_failover<T, F, Fut>(
    app: &AppHandle,
    settings: &AppSettings,
    plan: ExecutionPlan,
    mut attempt: F,
) -> ExecutionOutcome<T>
where
    F: FnMut(&str) -> Fut,
    Fut: Future<Output = AttemptResult<T>>,
{
    let key_selector = app.state::<KeySelector>();
    execute_with_failover_with_selector(&key_selector, settings, plan, move |api_key| {
        attempt(api_key)
    })
    .await
}

async fn execute_with_failover_with_selector<T, F, Fut>(
    key_selector: &KeySelector,
    settings: &AppSettings,
    plan: ExecutionPlan,
    mut attempt: F,
) -> ExecutionOutcome<T>
where
    F: FnMut(&str) -> Fut,
    Fut: Future<Output = AttemptResult<T>>,
{
    let keys = settings
        .post_process_api_keys
        .get(&plan.provider_id)
        .cloned()
        .unwrap_or_default();

    let mut attempted_indices = HashSet::new();
    let mut attempts = 0usize;
    let mut last_error: Option<AttemptError> = None;
    let mut cooldown_fallback_used = false;

    while attempts < plan.max_attempts {
        let Some(acquired_key) = key_selector.acquire_next_key(
            &plan.provider_id,
            &keys,
            &attempted_indices,
            cooldown_fallback_used,
        ) else {
            break;
        };

        attempted_indices.insert(acquired_key.key_index);
        cooldown_fallback_used |= acquired_key.from_cooldown_fallback;
        attempts += 1;

        match attempt(acquired_key.api_key).await {
            Ok(value) => {
                key_selector.report_success(&plan.provider_id, acquired_key.key_index);
                return ExecutionOutcome::Success(value);
            }
            Err(AttemptError::Retryable {
                status,
                detail,
                kind,
            }) => {
                key_selector.mark_error(
                    &plan.provider_id,
                    acquired_key.key_index,
                    status.unwrap_or(503),
                );
                last_error = Some(AttemptError::Retryable {
                    status,
                    detail,
                    kind,
                });
            }
            Err(AttemptError::Fatal {
                detail,
                status,
                kind,
            }) => {
                return ExecutionOutcome::Fatal {
                    provider_id: plan.provider_id,
                    detail,
                    status,
                    kind,
                };
            }
        }
    }

    ExecutionOutcome::Exhausted {
        provider_id: plan.provider_id,
        attempts,
        last_error: last_error.unwrap_or_else(|| AttemptError::Retryable {
            status: None,
            detail: "No available API key for provider".to_string(),
            kind: AttemptErrorKind::Other,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        execute_with_failover_with_selector, AttemptError, AttemptErrorKind, ExecutionOutcome,
        ExecutionPlan,
    };
    use crate::settings::{get_default_settings, AppSettings, KeyEntry, SecretKeyRing};
    use std::collections::HashMap;

    fn key(value: &str) -> KeyEntry {
        KeyEntry {
            key: value.to_string(),
            enabled: true,
            label: None,
        }
    }

    fn build_settings(keys: Vec<KeyEntry>) -> AppSettings {
        let mut settings = get_default_settings();
        settings.post_process_api_keys =
            SecretKeyRing(HashMap::from([("provider-a".to_string(), keys)]));
        settings
    }

    #[tokio::test]
    async fn retries_on_retryable_errors_and_returns_success() {
        let selector = crate::key_selector::KeySelector::new();
        let settings = build_settings(vec![key("k1"), key("k2")]);
        let plan = ExecutionPlan {
            provider_id: "provider-a".to_string(),
            cached_model_id: "cached-1".to_string(),
            remote_model_id: "remote-1".to_string(),
            max_attempts: 2,
        };

        let mut attempts = Vec::new();
        let outcome = execute_with_failover_with_selector(&selector, &settings, plan, |api_key| {
            let api_key = api_key.to_string();
            attempts.push(api_key.clone());
            async move {
                if api_key == "k1" {
                    Err(AttemptError::Retryable {
                        status: Some(429),
                        detail: "rate limited".to_string(),
                        kind: AttemptErrorKind::Http,
                    })
                } else {
                    Ok("ok".to_string())
                }
            }
        })
        .await;

        match outcome {
            ExecutionOutcome::Success(value) => assert_eq!(value, "ok"),
            other => panic!("expected success, got {other:?}"),
        }

        assert_eq!(attempts, vec!["k1".to_string(), "k2".to_string()]);
    }

    #[tokio::test]
    async fn stops_immediately_on_fatal_400() {
        let selector = crate::key_selector::KeySelector::new();
        let settings = build_settings(vec![key("k1"), key("k2")]);
        let plan = ExecutionPlan {
            provider_id: "provider-a".to_string(),
            cached_model_id: "cached-1".to_string(),
            remote_model_id: "remote-1".to_string(),
            max_attempts: 2,
        };

        let mut attempts = Vec::new();
        let outcome = execute_with_failover_with_selector(&selector, &settings, plan, |api_key| {
            let api_key = api_key.to_string();
            attempts.push(api_key.clone());
            async move {
                Err::<String, _>(AttemptError::Fatal {
                    status: Some(400),
                    detail: "bad request".to_string(),
                    kind: AttemptErrorKind::Http,
                })
            }
        })
        .await;

        match outcome {
            ExecutionOutcome::Fatal {
                provider_id,
                detail,
                status,
                kind,
            } => {
                assert_eq!(provider_id, "provider-a");
                assert!(detail.contains("bad request"));
                assert_eq!(status, Some(400));
                assert_eq!(kind, AttemptErrorKind::Http);
            }
            other => panic!("expected fatal, got {other:?}"),
        }

        assert_eq!(attempts, vec!["k1".to_string()]);
    }

    #[tokio::test]
    async fn returns_exhausted_when_all_retryable_attempts_fail() {
        let selector = crate::key_selector::KeySelector::new();
        let settings = build_settings(vec![key("k1"), key("k2")]);
        let plan = ExecutionPlan {
            provider_id: "provider-a".to_string(),
            cached_model_id: "cached-1".to_string(),
            remote_model_id: "remote-1".to_string(),
            max_attempts: 2,
        };

        let mut attempts = Vec::new();
        let outcome = execute_with_failover_with_selector(&selector, &settings, plan, |api_key| {
            let api_key = api_key.to_string();
            attempts.push(api_key.clone());
            async move {
                Err::<String, _>(AttemptError::Retryable {
                    status: Some(503),
                    detail: format!("temporary failure on {api_key}"),
                    kind: AttemptErrorKind::Http,
                })
            }
        })
        .await;

        match outcome {
            ExecutionOutcome::Exhausted {
                provider_id,
                attempts: attempt_count,
                last_error,
            } => {
                assert_eq!(provider_id, "provider-a");
                assert_eq!(attempt_count, 2);
                assert!(matches!(
                    last_error,
                    AttemptError::Retryable {
                        status: Some(503),
                        kind: AttemptErrorKind::Http,
                        ..
                    }
                ));
            }
            other => panic!("expected exhausted, got {other:?}"),
        }

        assert_eq!(attempts, vec!["k1".to_string(), "k2".to_string()]);
    }
}
