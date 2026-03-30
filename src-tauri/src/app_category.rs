/// Derive an application category from the app name.
///
/// Categories help skill prompts adapt their tone and formatting
/// without requiring conditional branches inside the prompt itself.
pub fn from_app_name(name: &str) -> &'static str {
    let lower = name.to_lowercase();

    // CodeEditor
    if matches_any(
        &lower,
        &[
            "visual studio code",
            "code",
            "vscode",
            "cursor",
            "xcode",
            "intellij",
            "pycharm",
            "webstorm",
            "goland",
            "clion",
            "rider",
            "rustrover",
            "android studio",
            "sublime",
            "sublime text",
            "vim",
            "neovim",
            "nvim",
            "emacs",
            "nova",
            "textmate",
            "bbedit",
            "zed",
            "fleet",
            "lapce",
            "helix",
        ],
    ) {
        return "CodeEditor";
    }

    // Terminal
    if matches_any(
        &lower,
        &[
            "terminal",
            "iterm",
            "iterm2",
            "warp",
            "alacritty",
            "kitty",
            "hyper",
            "tabby",
            "wezterm",
            "rio",
            "ghostty",
        ],
    ) {
        return "Terminal";
    }

    // InstantMessaging
    if matches_any(
        &lower,
        &[
            "wechat",
            "微信",
            "wecom",
            "企业微信",
            "telegram",
            "slack",
            "discord",
            "messages",
            "信息",
            "whatsapp",
            "teams",
            "microsoft teams",
            "lark",
            "飞书",
            "dingtalk",
            "钉钉",
            "line",
            "signal",
            "messenger",
        ],
    ) {
        return "InstantMessaging";
    }

    // Email
    if matches_any(
        &lower,
        &[
            "mail",
            "邮件",
            "outlook",
            "thunderbird",
            "spark",
            "airmail",
            "canary mail",
            "mimestream",
            "gmail",
            "newton",
            "mailmate",
        ],
    ) {
        return "Email";
    }

    // Notes
    if matches_any(
        &lower,
        &[
            "notion",
            "obsidian",
            "bear",
            "notes",
            "备忘录",
            "evernote",
            "onenote",
            "logseq",
            "roam",
            "craft",
            "ulysses",
            "typora",
            "marktext",
            "joplin",
            "apple notes",
            "day one",
        ],
    ) {
        return "Notes";
    }

    // Browser
    if matches_any(
        &lower,
        &[
            "safari",
            "chrome",
            "google chrome",
            "firefox",
            "edge",
            "microsoft edge",
            "arc",
            "brave",
            "vivaldi",
            "opera",
            "orion",
            "zen browser",
        ],
    ) {
        return "Browser";
    }

    "Other"
}

fn matches_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_code_editors() {
        assert_eq!(from_app_name("Visual Studio Code"), "CodeEditor");
        assert_eq!(from_app_name("Cursor"), "CodeEditor");
        assert_eq!(from_app_name("Xcode"), "CodeEditor");
        assert_eq!(from_app_name("Zed"), "CodeEditor");
    }

    #[test]
    fn test_terminals() {
        assert_eq!(from_app_name("Terminal"), "Terminal");
        assert_eq!(from_app_name("iTerm2"), "Terminal");
        assert_eq!(from_app_name("Warp"), "Terminal");
        assert_eq!(from_app_name("Ghostty"), "Terminal");
    }

    #[test]
    fn test_instant_messaging() {
        assert_eq!(from_app_name("WeChat"), "InstantMessaging");
        assert_eq!(from_app_name("微信"), "InstantMessaging");
        assert_eq!(from_app_name("Telegram"), "InstantMessaging");
        assert_eq!(from_app_name("Slack"), "InstantMessaging");
        assert_eq!(from_app_name("Discord"), "InstantMessaging");
    }

    #[test]
    fn test_email() {
        assert_eq!(from_app_name("Mail"), "Email");
        assert_eq!(from_app_name("Outlook"), "Email");
        assert_eq!(from_app_name("Spark"), "Email");
    }

    #[test]
    fn test_notes() {
        assert_eq!(from_app_name("Notion"), "Notes");
        assert_eq!(from_app_name("Obsidian"), "Notes");
        assert_eq!(from_app_name("备忘录"), "Notes");
    }

    #[test]
    fn test_browsers() {
        assert_eq!(from_app_name("Safari"), "Browser");
        assert_eq!(from_app_name("Google Chrome"), "Browser");
        assert_eq!(from_app_name("Arc"), "Browser");
    }

    #[test]
    fn test_other() {
        assert_eq!(from_app_name("Finder"), "Other");
        assert_eq!(from_app_name("Unknown App"), "Other");
    }
}
