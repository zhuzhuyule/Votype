//! Application insertion blacklist (Vokie-migration Phase A1).
//!
//! Never send simulated keystrokes/paste into blacklisted apps (terminals,
//! password managers, remote shells): a mis-delivered auto-Return there can
//! execute commands or leak secrets. On a hit the caller copies the text to
//! the clipboard instead and notifies the user to paste manually.
//!
//! Resolution order: user file `~/.votype/app_blacklist.json` (full
//! replacement) → built-in list compiled into the binary. Any load/parse
//! failure falls back to the next level; detection is fail-open (fetching the
//! frontmost app failing never blocks a normal paste).

use log::warn;
use serde::Deserialize;
use tauri::Manager;

const BUILTIN_JSON: &str = include_str!("../resources/config/app_blacklist.json");

#[derive(Debug, Default, Deserialize)]
struct BlacklistSection {
    #[serde(default)]
    exact: Vec<String>,
    #[serde(default)]
    regex: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct AppBlacklist {
    #[serde(default)]
    #[allow(dead_code)]
    version: String,
    #[serde(default)]
    macos: BlacklistSection,
    #[serde(default)]
    #[allow(dead_code)]
    windows: BlacklistSection,
    #[serde(default)]
    #[allow(dead_code)]
    linux: BlacklistSection,
}

impl AppBlacklist {
    fn platform_section(&self) -> &BlacklistSection {
        #[cfg(target_os = "macos")]
        {
            &self.macos
        }
        #[cfg(target_os = "windows")]
        {
            &self.windows
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            &self.linux
        }
    }
}

/// Info about a frontmost app, normalized for matching.
#[derive(Debug, Clone, Default)]
pub struct FrontApp {
    /// macOS bundle identifier (empty on other platforms / when unavailable).
    pub bundle_id: String,
    /// Localized app name or process name.
    pub app_name: String,
    /// Executable path if known (used to match `*.exe` style entries).
    pub process_path: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BlockedApp {
    pub app_name: String,
}

/// Case/format-insensitive compare key: lowercase, trimmed, `.exe` suffix stripped.
fn normalize(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    lower
        .strip_suffix(".exe")
        .unwrap_or(lower.as_str())
        .to_string()
}

fn candidates(app: &FrontApp) -> Vec<String> {
    let mut out = Vec::with_capacity(3);
    for raw in [app.bundle_id.as_str(), app.app_name.as_str()] {
        if !raw.trim().is_empty() {
            out.push(normalize(raw));
        }
    }
    if !app.process_path.trim().is_empty() {
        // Handle both POSIX and Windows separators regardless of host platform.
        let last = app
            .process_path
            .rsplit_once(|c: char| c == '/' || c == '\\')
            .map_or(app.process_path.as_str(), |(_, tail)| tail);
        if !last.trim().is_empty() {
            out.push(normalize(last));
        }
    }
    out
}

fn is_blocked_by(section: &BlacklistSection, app: &FrontApp) -> bool {
    let cand = candidates(app);
    if cand.is_empty() {
        return false;
    }
    if section.exact.iter().any(|entry| {
        let entry = normalize(entry);
        !entry.is_empty() && cand.iter().any(|c| c == &entry)
    }) {
        return true;
    }
    for pattern in &section.regex {
        match regex::RegexBuilder::new(pattern)
            .case_insensitive(true)
            .build()
        {
            Ok(re) => {
                if cand.iter().any(|c| re.is_match(c)) {
                    return true;
                }
            }
            Err(e) => warn!("[InsertGuard] invalid regex '{}' skipped: {}", pattern, e),
        }
    }
    false
}

fn builtin_config() -> AppBlacklist {
    serde_json::from_str(BUILTIN_JSON).unwrap_or_else(|e| {
        warn!(
            "[InsertGuard] builtin blacklist unreadable, guard disabled: {}",
            e
        );
        AppBlacklist::default()
    })
}

fn load_config(app_handle: &tauri::AppHandle) -> AppBlacklist {
    let user_path = app_handle
        .path()
        .home_dir()
        .map(|home| home.join(".votype").join("app_blacklist.json"));
    if let Ok(path) = user_path {
        if path.exists() {
            match std::fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|raw| {
                    serde_json::from_str::<AppBlacklist>(&raw).map_err(|e| e.to_string())
                }) {
                Ok(cfg) => return cfg,
                Err(e) => warn!(
                    "[InsertGuard] user blacklist {:?} invalid ({}), falling back to builtin",
                    path, e
                ),
            }
        }
    }
    builtin_config()
}

#[cfg(target_os = "macos")]
fn front_app() -> Option<FrontApp> {
    // safe_fetch only supplies pid + app_name (+ bundle id parked in window_id);
    // it never returns nil from AppKit calls, unlike the general fetch path.
    let info = crate::active_window::safe_fetch_frontmost_app_macos().ok()?;
    Some(FrontApp {
        bundle_id: info.window_id,
        app_name: info.app_name,
        process_path: info.process_path,
    })
}

#[cfg(not(target_os = "macos"))]
fn front_app() -> Option<FrontApp> {
    let info = crate::active_window::fetch_active_window().ok()?;
    Some(FrontApp {
        bundle_id: String::new(),
        app_name: info.app_name,
        process_path: info.process_path,
    })
}

/// Returns the blocked app when the current frontmost application is on the
/// insertion blacklist. Fail-open: any detection error means "not blocked".
pub fn detect_blocked_app(app_handle: &tauri::AppHandle) -> Option<BlockedApp> {
    let config = load_config(app_handle);
    let app = front_app()?;
    if is_blocked_by(config.platform_section(), &app) {
        Some(BlockedApp {
            app_name: if app.app_name.is_empty() {
                app.bundle_id.clone()
            } else {
                app.app_name.clone()
            },
        })
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn section(exact: &[&str], regex: &[&str]) -> BlacklistSection {
        BlacklistSection {
            exact: exact.iter().map(|s| s.to_string()).collect(),
            regex: regex.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn app(bundle: &str, name: &str, path: &str) -> FrontApp {
        FrontApp {
            bundle_id: bundle.to_string(),
            app_name: name.to_string(),
            process_path: path.to_string(),
        }
    }

    #[test]
    fn builtin_list_loads() {
        let cfg: AppBlacklist = serde_json::from_str(BUILTIN_JSON).expect("builtin json valid");
        assert!(!cfg.macos.exact.is_empty());
        assert!(cfg.macos.exact.iter().any(|e| e == "com.apple.Terminal"));
    }

    #[test]
    fn blocks_by_bundle_id() {
        let s = section(&["com.apple.Terminal"], &[]);
        assert!(is_blocked_by(
            &s,
            &app("com.apple.Terminal", "Terminal", "")
        ));
    }

    #[test]
    fn blocks_windows_exe_by_name_or_path_case_insensitive() {
        let s = section(&["powershell.exe"], &[]);
        assert!(is_blocked_by(&s, &app("", "powershell", "")));
        assert!(is_blocked_by(
            &s,
            &app(
                "",
                "Something",
                r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.EXE"
            )
        ));
    }

    #[test]
    fn blocks_by_regex() {
        let s = section(&[], &["^com\\.parallels\\..*\\.virtualmachine$", "term.*"]);
        assert!(is_blocked_by(
            &s,
            &app(
                "com.parallels.win10.abc123.virtualmachine",
                "Parallels VM",
                ""
            )
        ));
        assert!(is_blocked_by(&s, &app("", "iTerm", "")));
        assert!(!is_blocked_by(&s, &app("com.apple.Notes", "Notes", "")));
    }

    #[test]
    fn invalid_regex_fails_open() {
        let s = section(&[], &["(((bad"]);
        assert!(!is_blocked_by(&s, &app("com.apple.Notes", "Notes", "")));
    }

    #[test]
    fn unknown_app_not_blocked() {
        let cfg = builtin_config();
        assert!(!is_blocked_by(
            cfg.platform_section(),
            &app("com.apple.TextEdit", "TextEdit", "")
        ));
    }

    #[test]
    fn empty_candidates_not_blocked() {
        let s = section(&["com.apple.Terminal"], &[""]);
        assert!(!is_blocked_by(&s, &app("", "", "")));
    }
}
