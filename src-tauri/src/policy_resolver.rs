//! Unified per-app policy resolver.
//!
//! This is the single, synchronous, pure function that resolves the effective
//! review/prompt policy for the active window. It replaces four previously
//! divergent inline implementations (two in `actions/transcribe.rs`, one in
//! `clipboard.rs`, one in `shortcut/review_cmds.rs`).
//!
//! Priority chain ("specific overrides general"):
//!
//! ```text
//! global default (L1) → app category (L2) → specific app / AppProfile (L3) → TitleRule (L3.5)
//! ```
//!
//! Only two dimensions are hierarchical in Phase 0: review behaviour
//! (`AppReviewPolicy`) and prompt selection (`prompt_id`). The two remaining
//! outputs (`translate_to_english_on_insert`,
//! `disable_selection_clipboard_fallback`) are L3 direct pass-throughs.
//!
//! See docs/specs/2026-07-18-unified-policy-hierarchy.spec.md. The function has
//! **no IO, no locks, no async** and is unit-tested in isolation.

use crate::settings::{
    AppProfile, AppReviewPolicy, AppSettings, CategoryPolicy, TitleMatchType, TitleRule,
};

/// Built-in sentinel prompt ids that are not real prompts. A category-level
/// `prompt_id` carrying one of these (only reachable via hand-edited config,
/// the UI never offers them — spec decision 11) is treated as unset and is not
/// propagated downstream.
const SENTINEL_PROMPT_IDS: [&str; 2] = ["__PASS_THROUGH__", "__LITE_POLISH__"];

/// Which level of the hierarchy a resolved dimension came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyLevel {
    /// Global default (the `fallback_review_policy` argument / no override).
    Global,
    /// App category default (L2, from `category_policies`).
    Category,
    /// Specific app profile (L3, from `AppProfile`).
    App,
    /// Window-title rule within the app profile (L3.5, from `TitleRule`).
    TitleRule,
}

/// The resolved, effective policy for the active window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectivePolicy {
    pub review_policy: AppReviewPolicy,
    pub review_policy_source: PolicyLevel,
    /// `None` → downstream keeps `post_process_selected_prompt_id`.
    pub override_prompt_id: Option<String>,
    pub prompt_source: Option<PolicyLevel>,
    /// L3 direct pass-through dimension (not hierarchical).
    pub translate_to_english_on_insert: bool,
    /// L3 direct pass-through dimension (not hierarchical).
    pub disable_selection_clipboard_fallback: bool,
}

/// Find the `AppProfile` mapped to `app_name`, matching the app name
/// case-insensitively (`eq_ignore_ascii_case` — spec decision 8).
///
/// Public so callers that also need the matched `TitleRule` (e.g. the
/// transcribe pipeline's history-context filter) reuse the exact same lookup
/// instead of re-implementing it.
pub fn find_app_profile<'a>(settings: &'a AppSettings, app_name: &str) -> Option<&'a AppProfile> {
    let profile_id = settings
        .app_to_profile
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(app_name))
        .map(|(_, v)| v)?;
    settings.app_profiles.iter().find(|p| &p.id == profile_id)
}

/// Select the best matching title rule for `window_title`: among all rules that
/// match, the one with the longest pattern wins (so specific rules override
/// generic ones — s: `transcribe.rs` "longest pattern wins" semantics). Ties
/// resolve to the last maximum, matching the previous `max_by_key` behaviour.
///
/// Public for the same reason as [`find_app_profile`].
pub fn best_matching_rule<'a>(rules: &'a [TitleRule], window_title: &str) -> Option<&'a TitleRule> {
    rules
        .iter()
        .filter(|rule| rule_matches(rule, window_title))
        .max_by_key(|rule| rule.pattern.chars().count())
}

/// Whether a single title rule matches. Text matching keeps the existing
/// Unicode `to_lowercase().contains` semantics (spec decision 8 — must NOT be
/// changed to an ASCII-only variant). Invalid regex is treated as "no match"
/// and logged at debug level (spec decision 9: resolver runs on every
/// transcription/paste, so warn-level would spam and process-wide dedup would
/// require mutable state + a lock, violating the pure-function constraint).
fn rule_matches(rule: &TitleRule, window_title: &str) -> bool {
    match rule.match_type {
        TitleMatchType::Text => window_title
            .to_lowercase()
            .contains(&rule.pattern.to_lowercase()),
        TitleMatchType::Regex => match regex::Regex::new(&rule.pattern) {
            Ok(re) => re.is_match(window_title),
            Err(_) => {
                log::debug!(
                    "[Policy] invalid regex title rule ignored: id={} pattern={:?}",
                    rule.id,
                    rule.pattern
                );
                false
            }
        },
        TitleMatchType::Exact => window_title == rule.pattern,
    }
}

/// A category `prompt_id`, sanitised against sentinel ids (spec decision 11).
fn sanitized_category_prompt(policy: &CategoryPolicy) -> Option<String> {
    policy
        .prompt_id
        .as_ref()
        .filter(|id| !SENTINEL_PROMPT_IDS.contains(&id.as_str()))
        .cloned()
}

/// Resolve the effective policy for the active window.
///
/// `fallback_review_policy` is the global default to use when no more specific
/// level applies. The two transcribe call sites intentionally pass different
/// fallbacks (`Never` vs `Auto`); this difference is preserved verbatim
/// (spec decision 6) rather than unified.
pub fn resolve_effective_policy(
    settings: &AppSettings,
    app_name: Option<&str>,
    window_title: Option<&str>,
    fallback_review_policy: AppReviewPolicy,
) -> EffectivePolicy {
    // L3: the specific app profile (if any).
    let profile = app_name.and_then(|name| find_app_profile(settings, name));

    // L2: the category default — consulted ONLY when the app has no profile
    // (spec decision 4: an `AppProfile` — including one auto-created by the
    // suggestion engine — short-circuits the category level). Keeping this
    // `None` whenever a profile exists makes the review/prompt resolution below
    // naturally skip L2.
    let category_policy = if profile.is_none() {
        app_name
            .map(crate::app_category::from_app_name)
            .and_then(|category| settings.category_policies.get(category))
    } else {
        None
    };

    // L3.5: the best-matching title rule within the profile.
    let matched_rule = match (profile, window_title) {
        (Some(p), Some(title)) => best_matching_rule(&p.rules, title),
        _ => None,
    };

    // Review dimension: TitleRule → AppProfile → CategoryPolicy → fallback.
    // Note `AppReviewPolicy::Auto` is a terminal value (does NOT fall back to
    // the profile default), matching the previous `unwrap_or` semantics.
    let (review_policy, review_policy_source) = if let Some(rule) = matched_rule {
        (rule.policy, PolicyLevel::TitleRule)
    } else if let Some(p) = profile {
        (p.policy, PolicyLevel::App)
    } else if let Some(rp) = category_policy.and_then(|c| c.review_policy) {
        (rp, PolicyLevel::Category)
    } else {
        (fallback_review_policy, PolicyLevel::Global)
    };

    // Prompt dimension: TitleRule.prompt_id → AppProfile.prompt_id →
    // CategoryPolicy.prompt_id → None. A matched rule with no prompt_id falls
    // through to the profile's prompt_id (matching the previous
    // `and_then(..).or_else(..)` chain).
    let (override_prompt_id, prompt_source) =
        if let Some(pid) = matched_rule.and_then(|r| r.prompt_id.clone()) {
            (Some(pid), Some(PolicyLevel::TitleRule))
        } else if let Some(pid) = profile.and_then(|p| p.prompt_id.clone()) {
            (Some(pid), Some(PolicyLevel::App))
        } else if let Some(pid) = category_policy.and_then(sanitized_category_prompt) {
            (Some(pid), Some(PolicyLevel::Category))
        } else {
            (None, None)
        };

    // L3 direct pass-through dimensions (never hierarchical, never from title
    // rules or categories).
    let translate_to_english_on_insert = profile
        .map(|p| p.translate_to_english_on_insert)
        .unwrap_or(false);
    let disable_selection_clipboard_fallback = profile
        .map(|p| p.disable_selection_clipboard_fallback)
        .unwrap_or(false);

    EffectivePolicy {
        review_policy,
        review_policy_source,
        override_prompt_id,
        prompt_source,
        translate_to_english_on_insert,
        disable_selection_clipboard_fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::get_default_settings;

    fn text_rule(
        id: &str,
        pattern: &str,
        policy: AppReviewPolicy,
        prompt: Option<&str>,
    ) -> TitleRule {
        TitleRule {
            id: id.to_string(),
            pattern: pattern.to_string(),
            match_type: TitleMatchType::Text,
            policy,
            prompt_id: prompt.map(str::to_string),
        }
    }

    fn rule(
        id: &str,
        pattern: &str,
        match_type: TitleMatchType,
        policy: AppReviewPolicy,
        prompt: Option<&str>,
    ) -> TitleRule {
        TitleRule {
            id: id.to_string(),
            pattern: pattern.to_string(),
            match_type,
            policy,
            prompt_id: prompt.map(str::to_string),
        }
    }

    fn profile(
        id: &str,
        policy: AppReviewPolicy,
        prompt: Option<&str>,
        rules: Vec<TitleRule>,
    ) -> AppProfile {
        AppProfile {
            id: id.to_string(),
            name: id.to_string(),
            policy,
            prompt_id: prompt.map(str::to_string),
            icon: None,
            translate_to_english_on_insert: false,
            disable_selection_clipboard_fallback: false,
            rules,
        }
    }

    /// Register `profile` under `app_name` in a fresh settings object.
    fn settings_with_profile(app_name: &str, profile: AppProfile) -> AppSettings {
        let mut s = get_default_settings();
        s.app_to_profile
            .insert(app_name.to_string(), profile.id.clone());
        s.app_profiles.push(profile);
        s
    }

    fn category(review: Option<AppReviewPolicy>, prompt: Option<&str>) -> CategoryPolicy {
        CategoryPolicy {
            review_policy: review,
            prompt_id: prompt.map(str::to_string),
        }
    }

    /// Independent re-implementation of the OLD inline resolution logic shared by
    /// transcribe.rs points A and B (only the fallback differed). Used as a
    /// regression oracle for the legacy-parity test (spec scenario 3): the
    /// resolver, with no `category_policies`, must match this verbatim copy.
    fn legacy_resolve(
        settings: &AppSettings,
        app_name: Option<&str>,
        window_title: Option<&str>,
        fallback: AppReviewPolicy,
    ) -> (AppReviewPolicy, Option<String>) {
        let profile = app_name.and_then(|name| {
            let profile_id = settings
                .app_to_profile
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v);
            profile_id.and_then(|pid| settings.app_profiles.iter().find(|p| &p.id == pid))
        });

        let Some(p) = profile else {
            return (fallback, None);
        };

        let title = window_title.unwrap_or("");
        let matched_rule = p
            .rules
            .iter()
            .filter(|r| match r.match_type {
                TitleMatchType::Text => title.to_lowercase().contains(&r.pattern.to_lowercase()),
                TitleMatchType::Regex => regex::Regex::new(&r.pattern)
                    .map(|re| re.is_match(title))
                    .unwrap_or(false),
                TitleMatchType::Exact => title == r.pattern,
            })
            .max_by_key(|r| r.pattern.chars().count());

        let policy = matched_rule.map(|r| r.policy).unwrap_or(p.policy);
        let prompt = matched_rule
            .and_then(|r| r.prompt_id.clone())
            .or_else(|| p.prompt_id.clone());
        (policy, prompt)
    }

    // ── Scenario 1: category default applies (no profile) ────────────────────
    #[test]
    fn happy_path_category_default_applies() {
        let mut s = get_default_settings();
        s.category_policies.insert(
            "Terminal".to_string(),
            category(Some(AppReviewPolicy::Never), Some("code_prompt_id")),
        );

        let eff = resolve_effective_policy(
            &s,
            Some("Ghostty"),
            Some("~/project — zsh"),
            AppReviewPolicy::Never,
        );

        assert_eq!(eff.review_policy, AppReviewPolicy::Never);
        assert_eq!(eff.review_policy_source, PolicyLevel::Category);
        assert_eq!(eff.override_prompt_id.as_deref(), Some("code_prompt_id"));
        assert_eq!(eff.prompt_source, Some(PolicyLevel::Category));
    }

    // ── Scenario 2: specific (app / title rule) overrides general (category) ──
    #[test]
    fn happy_path_specific_overrides_general() {
        let mut s = settings_with_profile(
            "iTerm2",
            profile(
                "p_iterm",
                AppReviewPolicy::Always,
                None,
                vec![text_rule(
                    "r_vim",
                    "vim",
                    AppReviewPolicy::Never,
                    Some("p2"),
                )],
            ),
        );
        s.category_policies.insert(
            "Terminal".to_string(),
            category(Some(AppReviewPolicy::Never), None),
        );

        // (1) title without "vim": app profile wins over category.
        let eff = resolve_effective_policy(
            &s,
            Some("iTerm2"),
            Some("~/project — zsh"),
            AppReviewPolicy::Never,
        );
        assert_eq!(eff.review_policy, AppReviewPolicy::Always);
        assert_eq!(eff.review_policy_source, PolicyLevel::App);

        // (2) title with "vim": title rule wins over profile.
        let eff = resolve_effective_policy(
            &s,
            Some("iTerm2"),
            Some("vim ~/notes.md"),
            AppReviewPolicy::Never,
        );
        assert_eq!(eff.review_policy, AppReviewPolicy::Never);
        assert_eq!(eff.review_policy_source, PolicyLevel::TitleRule);
        assert_eq!(eff.override_prompt_id.as_deref(), Some("p2"));
        assert_eq!(eff.prompt_source, Some(PolicyLevel::TitleRule));
    }

    // ── Scenario 2 (cont.): longest pattern wins among multiple matches ──────
    #[test]
    fn longest_pattern_wins() {
        let s = settings_with_profile(
            "Slack",
            profile(
                "p_slack",
                AppReviewPolicy::Always,
                None,
                vec![
                    text_rule(
                        "r_short",
                        "Matt",
                        AppReviewPolicy::Always,
                        Some("p_generic"),
                    ),
                    text_rule(
                        "r_long",
                        "Matt M",
                        AppReviewPolicy::Never,
                        Some("p_specific"),
                    ),
                ],
            ),
        );

        let eff = resolve_effective_policy(
            &s,
            Some("Slack"),
            Some("Matt Miller — Slack"),
            AppReviewPolicy::Never,
        );
        // "Matt M" (6 chars) beats "Matt" (4 chars).
        assert_eq!(eff.review_policy, AppReviewPolicy::Never);
        assert_eq!(eff.review_policy_source, PolicyLevel::TitleRule);
        assert_eq!(eff.override_prompt_id.as_deref(), Some("p_specific"));
    }

    // ── Scenario 3: legacy config parity (no category_policies) ──────────────
    #[test]
    fn edge_case_legacy_config_parity() {
        // Build a rich, category-free settings object exercising: profile with
        // multiple rules (longest wins), Exact, Regex, Text-with-non-ASCII-case,
        // plus an app with no profile.
        let mut s = get_default_settings();

        let slack = profile(
            "p_slack",
            AppReviewPolicy::Always,
            Some("p_slack_default"),
            vec![
                text_rule("r_short", "Matt", AppReviewPolicy::Always, None),
                text_rule("r_long", "Matt M", AppReviewPolicy::Never, Some("p_matt")),
                rule(
                    "r_exact",
                    "Exact Window Title",
                    TitleMatchType::Exact,
                    AppReviewPolicy::Auto,
                    Some("p_exact"),
                ),
                rule(
                    "r_regex",
                    r"(?i)^release \d+\.\d+",
                    TitleMatchType::Regex,
                    AppReviewPolicy::Never,
                    None,
                ),
                // Non-ASCII case mapping: Turkish dotted capital I. Locks the
                // Unicode `to_lowercase().contains` semantics; an ASCII-only
                // variant would NOT match "İstanbul".
                rule(
                    "r_turkish",
                    "İSTANBUL",
                    TitleMatchType::Text,
                    AppReviewPolicy::Always,
                    Some("p_tr"),
                ),
            ],
        );
        s.app_to_profile
            .insert("Slack".to_string(), slack.id.clone());
        s.app_profiles.push(slack);

        // Sanity: category map deserialises/starts empty on legacy config.
        assert!(s.category_policies.is_empty());

        let cases: &[(Option<&str>, Option<&str>)] = &[
            (Some("Slack"), Some("Matt Miller — Slack")), // longest rule wins
            (Some("Slack"), Some("Matt — Slack")),        // short rule
            (Some("Slack"), Some("Exact Window Title")),  // exact rule (Auto)
            (Some("Slack"), Some("Release 12.3 notes")),  // regex rule
            (Some("Slack"), Some("Weather in İstanbul")), // turkish text rule
            (Some("Slack"), Some("nothing special here")), // no rule → profile
            (Some("slack"), Some("Matt Miller")),         // case-insensitive app
            (Some("UnknownApp"), Some("whatever")),       // no profile
            (None, None),                                 // no window
        ];

        for &(app, title) in cases {
            for fallback in [AppReviewPolicy::Never, AppReviewPolicy::Auto] {
                let eff = resolve_effective_policy(&s, app, title, fallback);
                let (want_policy, want_prompt) = legacy_resolve(&s, app, title, fallback);
                assert_eq!(
                    eff.review_policy, want_policy,
                    "policy mismatch app={app:?} title={title:?} fallback={fallback:?}"
                );
                assert_eq!(
                    eff.override_prompt_id, want_prompt,
                    "prompt mismatch app={app:?} title={title:?} fallback={fallback:?}"
                );
            }
        }

        // Explicit lock on the Turkish/Unicode case (guards against a future
        // `to_ascii_lowercase` "cleanup").
        let eff = resolve_effective_policy(
            &s,
            Some("Slack"),
            Some("Weather in İstanbul"),
            AppReviewPolicy::Never,
        );
        assert_eq!(eff.review_policy, AppReviewPolicy::Always);
        assert_eq!(eff.override_prompt_id.as_deref(), Some("p_tr"));

        // Roundtrip: serialise → deserialise loses nothing and re-hydrates an
        // empty category map from config that never had the key.
        let json = serde_json::to_string(&s).expect("serialise");
        assert!(!json.contains("\"category_policies\":null"));
        let back: AppSettings = serde_json::from_str(&json).expect("deserialise");
        assert!(back.category_policies.is_empty());
        assert_eq!(back.app_profiles.len(), s.app_profiles.len());
        assert_eq!(
            back.app_profiles[0].rules.len(),
            s.app_profiles[0].rules.len()
        );

        // A legacy blob with no `category_policies` key at all deserialises to
        // an empty map (serde default) — strip the key and re-parse.
        let mut val: serde_json::Value = serde_json::from_str(&json).unwrap();
        val.as_object_mut().unwrap().remove("category_policies");
        let stripped: AppSettings = serde_json::from_value(val).expect("deserialise-stripped");
        assert!(stripped.category_policies.is_empty());
    }

    // ── A/B fallback difference is preserved ─────────────────────────────────
    #[test]
    fn ab_fallback_difference_preserved() {
        let s = get_default_settings(); // no profiles, no categories

        let a = resolve_effective_policy(&s, Some("Finder"), Some("x"), AppReviewPolicy::Never);
        assert_eq!(a.review_policy, AppReviewPolicy::Never);
        assert_eq!(a.review_policy_source, PolicyLevel::Global);

        let b = resolve_effective_policy(&s, Some("Finder"), Some("x"), AppReviewPolicy::Auto);
        assert_eq!(b.review_policy, AppReviewPolicy::Auto);
        assert_eq!(b.review_policy_source, PolicyLevel::Global);
    }

    // ── Scenario 4: invalid regex rule → treated as no-match, no panic ───────
    #[test]
    fn error_path_invalid_regex_rule() {
        let s = settings_with_profile(
            "Editor",
            profile(
                "p_editor",
                AppReviewPolicy::Auto,
                None,
                vec![
                    rule(
                        "r_bad",
                        "([unclosed",
                        TitleMatchType::Regex,
                        AppReviewPolicy::Never,
                        None,
                    ),
                    text_rule("r_notes", "notes", AppReviewPolicy::Always, None),
                ],
            ),
        );

        // Text rule still matches; invalid regex is silently skipped.
        let eff =
            resolve_effective_policy(&s, Some("Editor"), Some("my notes"), AppReviewPolicy::Never);
        assert_eq!(eff.review_policy, AppReviewPolicy::Always);
        assert_eq!(eff.review_policy_source, PolicyLevel::TitleRule);

        // Only the bad regex present + no other match → falls back to profile.
        let s2 = settings_with_profile(
            "Editor",
            profile(
                "p_editor",
                AppReviewPolicy::Auto,
                None,
                vec![rule(
                    "r_bad",
                    "([unclosed",
                    TitleMatchType::Regex,
                    AppReviewPolicy::Never,
                    None,
                )],
            ),
        );
        let eff = resolve_effective_policy(
            &s2,
            Some("Editor"),
            Some("no match here"),
            AppReviewPolicy::Never,
        );
        assert_eq!(eff.review_policy, AppReviewPolicy::Auto);
        assert_eq!(eff.review_policy_source, PolicyLevel::App);
    }

    // ── Scenario 5: case-insensitive app lookup (the one intended fix) ───────
    #[test]
    fn edge_case_case_insensitive_unification() {
        let mut p = profile("p_ghostty", AppReviewPolicy::Auto, None, vec![]);
        p.disable_selection_clipboard_fallback = true;
        let s = settings_with_profile("Ghostty", p);

        // Reported app name differs in case from the stored key "Ghostty".
        let eff = resolve_effective_policy(&s, Some("ghostty"), None, AppReviewPolicy::Auto);
        assert!(
            eff.disable_selection_clipboard_fallback,
            "case-insensitive lookup must find the profile and honour disable=true"
        );

        // No profile at all → default false (fallback allowed).
        let eff2 = resolve_effective_policy(&s, Some("SomeOther"), None, AppReviewPolicy::Auto);
        assert!(!eff2.disable_selection_clipboard_fallback);
    }

    // ── Scenario 6: unknown / Other category ─────────────────────────────────
    #[test]
    fn edge_case_unknown_or_other_category() {
        // (a) hand-injected unknown category key is silently ignored, because
        // from_app_name never returns "Gaming".
        let mut s = get_default_settings();
        s.category_policies.insert(
            "Gaming".to_string(),
            category(Some(AppReviewPolicy::Always), None),
        );
        let eff = resolve_effective_policy(
            &s,
            Some("SomeRandomGame"),
            Some("Level 1"),
            AppReviewPolicy::Never,
        );
        assert_eq!(eff.review_policy, AppReviewPolicy::Never);
        assert_eq!(eff.review_policy_source, PolicyLevel::Global);

        // (b) "Other" is a valid category; Finder → Other.
        let mut s2 = get_default_settings();
        s2.category_policies.insert(
            "Other".to_string(),
            category(Some(AppReviewPolicy::Always), None),
        );
        let eff2 =
            resolve_effective_policy(&s2, Some("Finder"), Some("Desktop"), AppReviewPolicy::Never);
        assert_eq!(eff2.review_policy, AppReviewPolicy::Always);
        assert_eq!(eff2.review_policy_source, PolicyLevel::Category);
    }

    // ── Scenario 7 (backend part): category applies to IM app, others inherit ─
    #[test]
    fn happy_path_frontend_persistence_backend() {
        let mut s = get_default_settings();
        s.category_policies.insert(
            "InstantMessaging".to_string(),
            category(Some(AppReviewPolicy::Never), None),
        );

        // 微信 → InstantMessaging, no profile → category applies.
        let eff = resolve_effective_policy(&s, Some("微信"), Some("聊天"), AppReviewPolicy::Auto);
        assert_eq!(eff.review_policy, AppReviewPolicy::Never);
        assert_eq!(eff.review_policy_source, PolicyLevel::Category);

        // A Terminal app (different category, unconfigured) inherits the global
        // fallback.
        let eff2 =
            resolve_effective_policy(&s, Some("Ghostty"), Some("zsh"), AppReviewPolicy::Auto);
        assert_eq!(eff2.review_policy, AppReviewPolicy::Auto);
        assert_eq!(eff2.review_policy_source, PolicyLevel::Global);
    }

    // ── Scenario 8: AppProfile{policy:Auto} shadows the category (Auto is terminal) ──
    #[test]
    fn edge_case_profile_auto_shadows_category() {
        let mut s = get_default_settings();
        s.category_policies.insert(
            "Terminal".to_string(),
            category(Some(AppReviewPolicy::Never), None),
        );

        // (a) user-created profile {policy: Auto, rules: []}.
        let iterm = profile("p_iterm", AppReviewPolicy::Auto, None, vec![]);
        s.app_to_profile
            .insert("iTerm2".to_string(), iterm.id.clone());
        s.app_profiles.push(iterm);

        // (b) suggestion-engine-created profile {policy: Auto, rules: [Exact]},
        // current title does NOT hit the exact rule.
        let warp = profile(
            "p_warp",
            AppReviewPolicy::Auto,
            None,
            vec![rule(
                "r_auto",
                "Specific Session Title",
                TitleMatchType::Exact,
                AppReviewPolicy::Always,
                None,
            )],
        );
        s.app_to_profile.insert("Warp".to_string(), warp.id.clone());
        s.app_profiles.push(warp);

        for app in ["iTerm2", "Warp"] {
            let eff = resolve_effective_policy(
                &s,
                Some(app),
                Some("some other title"),
                AppReviewPolicy::Never,
            );
            assert_eq!(
                eff.review_policy,
                AppReviewPolicy::Auto,
                "profile Auto must be terminal and shadow the category for {app}"
            );
            assert_eq!(
                eff.review_policy_source,
                PolicyLevel::App,
                "source must be App (not Category) for {app}"
            );
        }
    }

    // ── Auto is terminal even at the title-rule level ────────────────────────
    #[test]
    fn title_rule_auto_is_terminal() {
        // rule=Auto + profile=Always: matching the Auto rule yields Auto, NOT a
        // fall-through to the profile's Always (locks decision 4 semantics).
        let s = settings_with_profile(
            "iTerm2",
            profile(
                "p_iterm",
                AppReviewPolicy::Always,
                None,
                vec![text_rule("r_auto", "scratch", AppReviewPolicy::Auto, None)],
            ),
        );
        let eff = resolve_effective_policy(
            &s,
            Some("iTerm2"),
            Some("scratch buffer"),
            AppReviewPolicy::Never,
        );
        assert_eq!(eff.review_policy, AppReviewPolicy::Auto);
        assert_eq!(eff.review_policy_source, PolicyLevel::TitleRule);
    }

    // ── Prompt falls through matched-rule(None) → profile prompt ─────────────
    #[test]
    fn prompt_rule_none_falls_through_to_profile() {
        let s = settings_with_profile(
            "iTerm2",
            profile(
                "p_iterm",
                AppReviewPolicy::Always,
                Some("p_profile"),
                vec![text_rule("r_x", "scratch", AppReviewPolicy::Never, None)],
            ),
        );
        let eff = resolve_effective_policy(
            &s,
            Some("iTerm2"),
            Some("scratch buffer"),
            AppReviewPolicy::Never,
        );
        // policy from the rule, prompt from the profile.
        assert_eq!(eff.review_policy, AppReviewPolicy::Never);
        assert_eq!(eff.review_policy_source, PolicyLevel::TitleRule);
        assert_eq!(eff.override_prompt_id.as_deref(), Some("p_profile"));
        assert_eq!(eff.prompt_source, Some(PolicyLevel::App));
    }

    // ── Sentinel prompt ids in a category are treated as unset ───────────────
    #[test]
    fn category_sentinel_prompt_is_ignored() {
        let mut s = get_default_settings();
        s.category_policies.insert(
            "Terminal".to_string(),
            category(Some(AppReviewPolicy::Never), Some("__PASS_THROUGH__")),
        );
        let eff =
            resolve_effective_policy(&s, Some("Ghostty"), Some("zsh"), AppReviewPolicy::Never);
        assert_eq!(eff.review_policy, AppReviewPolicy::Never);
        assert_eq!(
            eff.override_prompt_id, None,
            "sentinel must not be downstreamed"
        );
        assert_eq!(eff.prompt_source, None);

        s.category_policies.insert(
            "Terminal".to_string(),
            category(Some(AppReviewPolicy::Never), Some("__LITE_POLISH__")),
        );
        let eff2 =
            resolve_effective_policy(&s, Some("Ghostty"), Some("zsh"), AppReviewPolicy::Never);
        assert_eq!(eff2.override_prompt_id, None);
    }

    // ── translate_to_english_on_insert is an L3 pass-through, title-independent ─
    #[test]
    fn translate_flag_is_l3_passthrough() {
        let mut p = profile("p_mail", AppReviewPolicy::Auto, None, vec![]);
        p.translate_to_english_on_insert = true;
        let s = settings_with_profile("Mail", p);

        // No window title, case-insensitive app name.
        let eff = resolve_effective_policy(&s, Some("mail"), None, AppReviewPolicy::Auto);
        assert!(eff.translate_to_english_on_insert);

        // No profile → false.
        let eff2 = resolve_effective_policy(&s, Some("Other"), None, AppReviewPolicy::Auto);
        assert!(!eff2.translate_to_english_on_insert);
    }
}
