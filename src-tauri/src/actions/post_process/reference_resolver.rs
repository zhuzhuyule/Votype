//! Convention-based Reference resolver for Skill packages.
//!
//! Scans a Skill's `references/` directory and matches filenames against the
//! current app context. Matching rules:
//!
//! - `_always.md`           → always injected
//! - `{app_name}.md`        → injected when app_name matches (case-insensitive)
//! - `{app_category}.md`    → injected when app_category matches
//!
//! Multiple matches are all injected (not mutually exclusive).
//! Injection order: `_always` first, then app_name matches, then app_category matches.

use std::path::Path;

use log::{debug, warn};

/// Resolved references ready for injection into the system prompt.
#[derive(Debug, Default)]
pub struct ResolvedReferences {
    /// Concatenated reference content, ready to append to system layer.
    pub content: String,
    /// Number of reference files matched.
    pub count: usize,
    /// Matched filenames (for logging).
    pub matched_files: Vec<String>,
}

/// Resolve references for a Skill given the current app context.
///
/// `skill_file_path` should point to the Skill's `.md` file (e.g. `my_skill/SKILL.md`).
/// The resolver looks for a sibling `references/` directory.
pub fn resolve_references(
    skill_file_path: Option<&Path>,
    app_name: Option<&str>,
    app_category: &str,
) -> ResolvedReferences {
    let mut result = ResolvedReferences::default();

    let skill_dir = match skill_file_path.and_then(|p| p.parent()) {
        Some(dir) => dir,
        None => return result,
    };

    let refs_dir = skill_dir.join("references");
    if !refs_dir.is_dir() {
        return result;
    }

    let entries = match std::fs::read_dir(&refs_dir) {
        Ok(entries) => entries,
        Err(e) => {
            warn!("Failed to read references dir {:?}: {}", refs_dir, e);
            return result;
        }
    };

    // Collect all .md files, categorized by match type
    let mut always_refs: Vec<(String, String)> = Vec::new(); // (filename, content)
    let mut app_name_refs: Vec<(String, String)> = Vec::new();
    let mut category_refs: Vec<(String, String)> = Vec::new();

    let app_name_lower = app_name.map(|n| n.to_lowercase());

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path.extension().and_then(|e| e.to_str());
        if ext != Some("md") {
            continue;
        }

        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c.trim().to_string(),
            Err(e) => {
                warn!("Failed to read reference file {:?}: {}", path, e);
                continue;
            }
        };

        if content.is_empty() {
            continue;
        }

        let stem_lower = stem.to_lowercase();

        if stem_lower == "_always" {
            always_refs.push((stem, content));
        } else if app_name_lower.as_deref() == Some(&stem_lower) {
            app_name_refs.push((stem, content));
        } else if app_category.to_lowercase() == stem_lower {
            category_refs.push((stem, content));
        }
    }

    // Build result: _always → app_name → app_category
    let mut parts: Vec<String> = Vec::new();
    let mut matched: Vec<String> = Vec::new();

    for (name, content) in &always_refs {
        parts.push(content.clone());
        matched.push(format!("{}.md", name));
    }
    for (name, content) in &app_name_refs {
        parts.push(content.clone());
        matched.push(format!("{}.md", name));
    }
    for (name, content) in &category_refs {
        parts.push(content.clone());
        matched.push(format!("{}.md", name));
    }

    if !parts.is_empty() {
        debug!(
            "[Reference] Resolved {} reference(s) for app={:?} category={}: {:?}",
            parts.len(),
            app_name,
            app_category,
            matched,
        );

        result.content = parts.join("\n\n");
        result.count = parts.len();
        result.matched_files = matched;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_skill_with_refs(refs: &[(&str, &str)]) -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");
        fs::write(&skill_md, "---\nname: test\n---\nTest skill").unwrap();

        let refs_dir = dir.path().join("references");
        fs::create_dir(&refs_dir).unwrap();
        for (name, content) in refs {
            fs::write(refs_dir.join(name), content).unwrap();
        }

        (dir, skill_md)
    }

    #[test]
    fn test_always_reference() {
        let (_dir, skill_md) = setup_skill_with_refs(&[("_always.md", "Always rule")]);
        let result = resolve_references(Some(&skill_md), Some("Slack"), "InstantMessaging");
        assert_eq!(result.count, 1);
        assert!(result.content.contains("Always rule"));
    }

    #[test]
    fn test_app_name_match() {
        let (_dir, skill_md) =
            setup_skill_with_refs(&[("Slack.md", "Slack rules"), ("Mail.md", "Mail rules")]);
        let result = resolve_references(Some(&skill_md), Some("Slack"), "InstantMessaging");
        assert_eq!(result.count, 1);
        assert!(result.content.contains("Slack rules"));
        assert!(!result.content.contains("Mail rules"));
    }

    #[test]
    fn test_app_category_match() {
        let (_dir, skill_md) = setup_skill_with_refs(&[("InstantMessaging.md", "IM rules")]);
        let result = resolve_references(Some(&skill_md), Some("WeChat"), "InstantMessaging");
        assert_eq!(result.count, 1);
        assert!(result.content.contains("IM rules"));
    }

    #[test]
    fn test_case_insensitive() {
        let (_dir, skill_md) = setup_skill_with_refs(&[("slack.md", "Slack rules")]);
        let result = resolve_references(Some(&skill_md), Some("Slack"), "InstantMessaging");
        assert_eq!(result.count, 1);
    }

    #[test]
    fn test_multiple_matches() {
        let (_dir, skill_md) = setup_skill_with_refs(&[
            ("_always.md", "Base rules"),
            ("Slack.md", "Slack rules"),
            ("InstantMessaging.md", "IM rules"),
        ]);
        let result = resolve_references(Some(&skill_md), Some("Slack"), "InstantMessaging");
        assert_eq!(result.count, 3);
        // Verify order: _always → app_name → category
        let parts: Vec<&str> = result.content.split("\n\n").collect();
        assert_eq!(parts[0], "Base rules");
        assert_eq!(parts[1], "Slack rules");
        assert_eq!(parts[2], "IM rules");
    }

    #[test]
    fn test_no_references_dir() {
        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");
        fs::write(&skill_md, "test").unwrap();
        let result = resolve_references(Some(&skill_md), Some("Slack"), "InstantMessaging");
        assert_eq!(result.count, 0);
    }

    #[test]
    fn test_no_match() {
        let (_dir, skill_md) = setup_skill_with_refs(&[("Email.md", "Email rules")]);
        let result = resolve_references(Some(&skill_md), Some("Slack"), "InstantMessaging");
        assert_eq!(result.count, 0);
    }
}
