use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Instant;

/// Maximum number of entries to keep.
const MAX_ENTRIES: usize = 5;
/// Time window in milliseconds (5 minutes).
const WINDOW_MS: u128 = 300_000;
/// Maximum total characters across all returned entries (token budget).
const MAX_TOTAL_CHARS: usize = 500;

struct ContextEntry {
    text: String,
    timestamp: Instant,
    app_name: String,
}

struct RecentContextInner {
    entries: VecDeque<ContextEntry>,
}

impl RecentContextInner {
    fn new() -> Self {
        Self {
            entries: VecDeque::new(),
        }
    }

    fn evict_expired(&mut self) {
        while self
            .entries
            .front()
            .map_or(false, |e| e.timestamp.elapsed().as_millis() > WINDOW_MS)
        {
            self.entries.pop_front();
        }
    }

    fn push(&mut self, text: &str, app_name: &str) {
        self.evict_expired();
        self.entries.push_back(ContextEntry {
            text: text.to_string(),
            timestamp: Instant::now(),
            app_name: app_name.to_string(),
        });
        while self.entries.len() > MAX_ENTRIES {
            self.entries.pop_front();
        }
    }

    fn get_for_app(&mut self, app_name: &str) -> Vec<String> {
        self.evict_expired();
        let mut result = Vec::new();
        let mut total_chars = 0;
        for entry in self.entries.iter().rev() {
            if !entry.app_name.eq_ignore_ascii_case(app_name) {
                continue;
            }
            if total_chars + entry.text.len() > MAX_TOTAL_CHARS {
                break;
            }
            total_chars += entry.text.len();
            result.push(entry.text.clone());
        }
        result.reverse();
        result
    }
}

static RECENT_CONTEXT: std::sync::LazyLock<Mutex<RecentContextInner>> =
    std::sync::LazyLock::new(|| Mutex::new(RecentContextInner::new()));

/// Record a completed transcription result for session context.
pub fn push(text: &str, app_name: &str) {
    if text.trim().is_empty() || app_name.is_empty() {
        return;
    }
    if let Ok(mut ctx) = RECENT_CONTEXT.lock() {
        ctx.push(text, app_name);
    }
}

/// Get recent context entries for the same app, within time window and char budget.
/// Returns empty vec if no relevant context exists.
pub fn get_for_app(app_name: &str) -> Vec<String> {
    if app_name.is_empty() {
        return Vec::new();
    }
    RECENT_CONTEXT
        .lock()
        .map(|mut ctx| ctx.get_for_app(app_name))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_and_get() {
        let mut ctx = RecentContextInner::new();
        ctx.push("Hello", "Slack");
        ctx.push("World", "Slack");
        ctx.push("Code stuff", "VSCode");

        let slack_ctx = ctx.get_for_app("Slack");
        assert_eq!(slack_ctx, vec!["Hello", "World"]);

        let vscode_ctx = ctx.get_for_app("VSCode");
        assert_eq!(vscode_ctx, vec!["Code stuff"]);
    }

    #[test]
    fn test_max_entries() {
        let mut ctx = RecentContextInner::new();
        for i in 0..10 {
            ctx.push(&format!("Entry {}", i), "App");
        }
        let entries = ctx.get_for_app("App");
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[0], "Entry 5");
    }

    #[test]
    fn test_char_budget() {
        let mut ctx = RecentContextInner::new();
        // Each entry is ~200 chars, budget is 500
        let long_text = "a".repeat(200);
        ctx.push(&long_text, "App");
        ctx.push(&long_text, "App");
        ctx.push(&long_text, "App");

        let entries = ctx.get_for_app("App");
        // Only 2 fit within 500 chars (200 + 200 = 400 < 500, 200+200+200 = 600 > 500)
        assert_eq!(entries.len(), 2);
    }
}
