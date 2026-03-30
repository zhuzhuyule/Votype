#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VotypeInputMode {
    MainPolishInput,
    MainSelectedEdit,
    ReviewRewrite,
    ExternalDefault,
}

pub fn resolve_votype_input_mode(
    app_name: Option<&str>,
    window_title: Option<&str>,
    _review_editor_active: bool,
    has_selected_text: bool,
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
            VotypeInputMode::ReviewRewrite
        }
        Some(title) if title.eq_ignore_ascii_case("votype") => {
            if has_selected_text {
                VotypeInputMode::MainSelectedEdit
            } else {
                VotypeInputMode::MainPolishInput
            }
        }
        _ => {
            if has_selected_text {
                VotypeInputMode::MainSelectedEdit
            } else {
                VotypeInputMode::MainPolishInput
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_votype_input_mode, VotypeInputMode};

    #[test]
    fn main_window_always_uses_polish_input_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Votype"), false, false);
        assert_eq!(mode, VotypeInputMode::MainPolishInput);
    }

    #[test]
    fn review_window_with_editor_cursor_uses_polish_input_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Votype Review"), true, false);
        assert_eq!(mode, VotypeInputMode::ReviewRewrite);
    }

    #[test]
    fn review_window_without_editor_cursor_uses_rewrite_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Votype Review"), false, false);
        assert_eq!(mode, VotypeInputMode::ReviewRewrite);
    }

    #[test]
    fn external_apps_keep_default_mode() {
        let mode = resolve_votype_input_mode(Some("Slack"), Some("General"), false, false);
        assert_eq!(mode, VotypeInputMode::ExternalDefault);
    }

    #[test]
    fn main_window_with_selection_uses_selected_edit_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Votype"), false, true);
        assert_eq!(mode, VotypeInputMode::MainSelectedEdit);
    }

    #[test]
    fn unknown_votype_window_with_selection_still_uses_selected_edit_mode() {
        let mode = resolve_votype_input_mode(Some("Votype"), Some("Other"), false, true);
        assert_eq!(mode, VotypeInputMode::MainSelectedEdit);
    }
}
