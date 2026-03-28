#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VotypeInputMode {
    MainPolishInput,
    ReviewPolishInput,
    ReviewSkill,
    ExternalDefault,
}

pub fn resolve_votype_input_mode(
    app_name: Option<&str>,
    window_title: Option<&str>,
    review_editor_active: bool,
) -> VotypeInputMode {
    let normalized_app = app_name.map(str::trim).filter(|value| !value.is_empty());
    let normalized_title = window_title
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let is_votype_app = normalized_app
        .map(|value| value.eq_ignore_ascii_case("votype"))
        .unwrap_or(false);

    if !is_votype_app {
        return VotypeInputMode::ExternalDefault;
    }

    match normalized_title {
        Some(title) if title.eq_ignore_ascii_case("votype review") => {
            if review_editor_active {
                VotypeInputMode::ReviewPolishInput
            } else {
                VotypeInputMode::ReviewSkill
            }
        }
        Some(title) if title.eq_ignore_ascii_case("votype") => VotypeInputMode::MainPolishInput,
        _ => VotypeInputMode::MainPolishInput,
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_votype_input_mode, VotypeInputMode};

    #[test]
    fn main_window_always_uses_polish_input_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Votype"), false);
        assert_eq!(mode, VotypeInputMode::MainPolishInput);
    }

    #[test]
    fn review_window_with_editor_cursor_uses_polish_input_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Votype Review"), true);
        assert_eq!(mode, VotypeInputMode::ReviewPolishInput);
    }

    #[test]
    fn review_window_without_editor_cursor_uses_skill_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Votype Review"), false);
        assert_eq!(mode, VotypeInputMode::ReviewSkill);
    }

    #[test]
    fn external_apps_keep_default_mode() {
        let mode = resolve_votype_input_mode(Some("Slack"), Some("General"), false);
        assert_eq!(mode, VotypeInputMode::ExternalDefault);
    }
}
