use crate::input::{self, EnigoState};
use crate::settings::{get_settings, AppSettings, AutoSubmitKey, ClipboardHandling, PasteMethod};
use enigo::{Direction, Enigo, Key, Keyboard};
use log::info;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[cfg(target_os = "linux")]
use crate::utils::is_wayland;
#[cfg(target_os = "linux")]
use std::process::Command;

/// Pastes text using the clipboard: saves current content, writes text, sends paste keystroke, restores clipboard.
fn paste_via_clipboard(
    enigo: &mut Enigo,
    text: &str,
    app_handle: &AppHandle,
    paste_method: &PasteMethod,
) -> Result<(), String> {
    let clipboard = app_handle.clipboard();
    let clipboard_content = clipboard.read_text().unwrap_or_default();

    clipboard
        .write_text(text)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(50));

    #[cfg(target_os = "linux")]
    let pasted_with_wayland_tool = try_wayland_send_paste(paste_method)?;
    #[cfg(not(target_os = "linux"))]
    let pasted_with_wayland_tool = false;

    if !pasted_with_wayland_tool {
        match paste_method {
            PasteMethod::CtrlV => input::send_paste_ctrl_v(enigo)?,
            PasteMethod::CtrlShiftV => input::send_paste_ctrl_shift_v(enigo)?,
            #[cfg(not(target_os = "macos"))]
            PasteMethod::ShiftInsert => input::send_paste_shift_insert(enigo)?,
            _ => return Err("Invalid paste method for clipboard paste".into()),
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(50));
    clipboard
        .write_text(&clipboard_content)
        .map_err(|e| format!("Failed to restore clipboard: {}", e))?;

    Ok(())
}

/// Attempts to paste using Wayland-specific tools (`wtype` or `dotool`).
/// Returns `Ok(true)` if a Wayland tool handled the paste, `Ok(false)` if not applicable,
/// or `Err` on failure from the underlying tool.
#[cfg(target_os = "linux")]
fn try_wayland_send_paste(paste_method: &PasteMethod) -> Result<bool, String> {
    if is_wayland() {
        if is_wtype_available() {
            send_paste_via_wtype(paste_method)?;
            return Ok(true);
        } else if is_dotool_available() {
            send_paste_via_dotool(paste_method)?;
            return Ok(true);
        }
    }

    Ok(false)
}

/// Check if wtype is available (Wayland text input tool)
#[cfg(target_os = "linux")]
fn is_wtype_available() -> bool {
    Command::new("which")
        .arg("wtype")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Check if dotool is available (another Wayland text input tool)
#[cfg(target_os = "linux")]
fn is_dotool_available() -> bool {
    Command::new("which")
        .arg("dotool")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Paste using wtype and return a friendly error on failure.
#[cfg(target_os = "linux")]
fn send_paste_via_wtype(paste_method: &PasteMethod) -> Result<(), String> {
    let args: Vec<&str> = match paste_method {
        PasteMethod::CtrlV => vec!["-M", "ctrl", "-k", "v"],
        PasteMethod::ShiftInsert => vec!["-M", "shift", "-k", "Insert"],
        PasteMethod::CtrlShiftV => vec!["-M", "ctrl", "-M", "shift", "-k", "v"],
        _ => return Err("Unsupported paste method".into()),
    };

    let output = Command::new("wtype")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute wtype: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("wtype failed: {}", stderr));
    }

    Ok(())
}

/// Paste using dotool and return a friendly error on failure.
#[cfg(target_os = "linux")]
fn send_paste_via_dotool(paste_method: &PasteMethod) -> Result<(), String> {
    let command;
    match paste_method {
        PasteMethod::CtrlV => command = "echo key ctrl+v | dotool",
        PasteMethod::ShiftInsert => command = "echo key shift+insert | dotool",
        PasteMethod::CtrlShiftV => command = "echo key ctrl+shift+v | dotool",
        _ => return Err("Unsupported paste method".into()),
    }
    let output = Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| format!("Failed to execute dotool: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("dotool failed: {}", stderr));
    }

    Ok(())
}

pub fn paste(text: String, app_handle: AppHandle) -> Result<(), String> {
    let settings = get_settings(&app_handle);

    // Insertion blacklist guard: never type/paste into blacklisted apps
    // (terminals, password managers, …). Deliver via clipboard + user toast.
    if settings.insert_blacklist_enabled {
        if let Some(blocked) = crate::insert_guard::detect_blocked_app(&app_handle) {
            log::info!(
                "[InsertGuard] insertion blocked for blacklisted app '{}', text copied to clipboard",
                blocked.app_name
            );
            let clipboard = app_handle.clipboard();
            clipboard
                .write_text(&text)
                .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
            let _ = app_handle.emit(
                "insert-blocked",
                serde_json::json!({ "app_name": blocked.app_name }),
            );
            return Ok(());
        }
    }

    let paste_method = settings.paste_method;

    // Append trailing space if setting is enabled
    let text = if settings.append_trailing_space {
        format!("{} ", text)
    } else {
        text
    };

    info!("Using paste method: {:?}", paste_method);

    // Get the managed Enigo instance (lazy initialization)
    let enigo_state = app_handle
        .try_state::<EnigoState>()
        .ok_or("Enigo state not initialized")?;
    let mut enigo_opt = enigo_state.get_or_init()?;
    let enigo = enigo_opt
        .as_mut()
        .ok_or("Failed to initialize input system")?;

    // Perform the paste operation
    match paste_method {
        PasteMethod::None => {
            info!("PasteMethod::None selected - skipping paste action");
        }
        PasteMethod::Direct => input::paste_text_direct(enigo, &text)?,
        PasteMethod::CtrlV => paste_via_clipboard(enigo, &text, &app_handle, &paste_method)?,
        PasteMethod::CtrlShiftV => paste_via_clipboard(enigo, &text, &app_handle, &paste_method)?,
        PasteMethod::ShiftInsert => paste_via_clipboard(enigo, &text, &app_handle, &paste_method)?,
        PasteMethod::ExternalScript => {
            log::info!("PasteMethod::ExternalScript selected - using external script");
            let script_path = settings.external_script_path.as_deref().unwrap_or_default();
            input::paste_text_external(enigo, &text, script_path, &app_handle)?;
        }
    }

    if should_send_auto_submit(settings.auto_submit, paste_method) {
        std::thread::sleep(Duration::from_millis(50));
        send_return_key(enigo, settings.auto_submit_key)?;
    }

    // After pasting, optionally copy to clipboard based on settings
    if settings.clipboard_handling == ClipboardHandling::CopyToClipboard {
        let clipboard = app_handle.clipboard();
        clipboard
            .write_text(&text)
            .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
    }

    Ok(())
}

/// Get the currently selected text from the active application.
/// On macOS, uses Accessibility API (AXSelectedText).
/// On other platforms, returns empty (UI Automation / AT-SPI2 not yet implemented).
pub fn get_selected_text(_app_handle: &AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let active_window = crate::active_window::fetch_active_window().ok();
        let active_app_name = active_window.as_ref().map(|info| info.app_name.as_str());
        let settings = get_settings(_app_handle);

        match get_selected_text_via_accessibility() {
            Ok(text) if !text.is_empty() => {
                info!(
                    "[Selection] Got text via Accessibility API: {} chars",
                    text.len()
                );
                Ok(text)
            }
            Ok(_) => {
                info!("[Selection] Accessibility API returned empty, trying fallback if enabled");
                get_selected_text_with_fallback(_app_handle, &settings, active_app_name)
            }
            Err(e) => {
                info!(
                    "[Selection] Accessibility API failed ({}), trying fallback if enabled",
                    e
                );
                get_selected_text_with_fallback(_app_handle, &settings, active_app_name)
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        info!("[Selection] Selected text detection not supported on this platform");
        Ok(String::new())
    }
}

fn send_return_key(enigo: &mut Enigo, key_type: AutoSubmitKey) -> Result<(), String> {
    match key_type {
        AutoSubmitKey::Enter => {
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
        }
        AutoSubmitKey::CtrlEnter => {
            enigo
                .key(Key::Control, Direction::Press)
                .map_err(|e| format!("Failed to press Control key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
            enigo
                .key(Key::Control, Direction::Release)
                .map_err(|e| format!("Failed to release Control key: {}", e))?;
        }
        AutoSubmitKey::CmdEnter => {
            enigo
                .key(Key::Meta, Direction::Press)
                .map_err(|e| format!("Failed to press Meta/Cmd key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
            enigo
                .key(Key::Meta, Direction::Release)
                .map_err(|e| format!("Failed to release Meta/Cmd key: {}", e))?;
        }
    }

    Ok(())
}

fn should_send_auto_submit(auto_submit: bool, paste_method: PasteMethod) -> bool {
    auto_submit && paste_method != PasteMethod::None
}

fn should_use_selection_clipboard_fallback(
    settings: &AppSettings,
    active_app_name: Option<&str>,
) -> bool {
    let Some(app_name) = active_app_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
    else {
        return true;
    };

    if is_selection_clipboard_fallback_unsafe_app(app_name) {
        return false;
    }

    // Resolve via the unified policy resolver. `disable_selection_clipboard_fallback`
    // is an L3 direct pass-through dimension (title rules do not participate), so
    // window_title = None (spec decision 5). The app-name lookup is
    // case-insensitive, fixing the previous case-sensitive `get()` that silently
    // dropped the config on a case mismatch (spec decision 8).
    let effective = crate::policy_resolver::resolve_effective_policy(
        settings,
        Some(app_name),
        None,
        crate::settings::AppReviewPolicy::Auto,
    );
    !effective.disable_selection_clipboard_fallback
}

fn is_selection_clipboard_fallback_unsafe_app(app_name: &str) -> bool {
    matches!(
        app_name.to_ascii_lowercase().as_str(),
        "ghostty" | "terminal" | "iterm2" | "wezterm" | "alacritty" | "kitty" | "warp"
    )
}

#[cfg(target_os = "macos")]
fn get_selected_text_with_fallback(
    app_handle: &AppHandle,
    settings: &AppSettings,
    active_app_name: Option<&str>,
) -> Result<String, String> {
    if !should_use_selection_clipboard_fallback(settings, active_app_name) {
        info!(
            "[Selection] Clipboard fallback disabled or blocked for app {:?}",
            active_app_name
        );
        return Ok(String::new());
    }

    get_selected_text_via_clipboard_fallback(app_handle)
}

/// Get selected text using macOS Accessibility API (AXSelectedText).
/// This is more efficient as it doesn't affect the clipboard.
#[cfg(target_os = "macos")]
fn get_selected_text_via_accessibility() -> Result<String, String> {
    use core_foundation::base::{CFRelease, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: CFStringRef,
            value: *mut *mut c_void,
        ) -> i32;
    }

    unsafe {
        // Create system-wide accessibility element
        let system_element = AXUIElementCreateSystemWide();
        if system_element.is_null() {
            return Err("Failed to create system-wide AXUIElement".to_string());
        }

        // Get the focused UI element
        let focused_attr = CFString::new("AXFocusedUIElement");
        let mut focused_element: *mut c_void = ptr::null_mut();
        let result = AXUIElementCopyAttributeValue(
            system_element,
            focused_attr.as_concrete_TypeRef(),
            &mut focused_element,
        );

        if result != 0 || focused_element.is_null() {
            CFRelease(system_element);
            return Err("Failed to get focused UI element".to_string());
        }

        // Get the selected text from the focused element
        let selected_text_attr = CFString::new("AXSelectedText");
        let mut selected_text_value: *mut c_void = ptr::null_mut();
        let result = AXUIElementCopyAttributeValue(
            focused_element,
            selected_text_attr.as_concrete_TypeRef(),
            &mut selected_text_value,
        );

        CFRelease(focused_element);
        CFRelease(system_element);

        if result != 0 || selected_text_value.is_null() {
            return Err("Failed to get selected text".to_string());
        }

        // Convert CFString to Rust String
        let cf_text = CFString::wrap_under_create_rule(selected_text_value as CFStringRef);
        let text = cf_text.to_string();

        Ok(text)
    }
}

#[cfg(target_os = "macos")]
fn get_selected_text_via_clipboard_fallback(app_handle: &AppHandle) -> Result<String, String> {
    let clipboard = app_handle.clipboard();
    let original_text = clipboard.read_text().unwrap_or_default();
    let original_change_count = get_clipboard_change_count();

    let enigo_state = app_handle
        .try_state::<EnigoState>()
        .ok_or("Enigo state not initialized")?;
    let mut enigo_opt = enigo_state.get_or_init()?;
    let enigo = enigo_opt
        .as_mut()
        .ok_or("Failed to initialize input system")?;

    crate::input::send_copy_shortcut(enigo)?;
    std::thread::sleep(std::time::Duration::from_millis(120));

    let copied_change_count = get_clipboard_change_count();
    let copied_text = clipboard
        .read_text()
        .map_err(|e| format!("Failed to read clipboard after copy: {}", e))?;

    clipboard
        .write_text(&original_text)
        .map_err(|e| format!("Failed to restore clipboard after copy fallback: {}", e))?;

    let trimmed = copied_text.trim();
    let changed = copied_change_count > original_change_count;
    if !changed {
        info!(
            "[Selection] Clipboard fallback ignored unchanged clipboard (change_count={} text_unchanged={})",
            copied_change_count,
            copied_text == original_text
        );
        return Ok(String::new());
    }

    if trimmed.is_empty() {
        info!("[Selection] Clipboard fallback returned empty text after clipboard change");
        return Ok(String::new());
    }

    info!(
        "[Selection] Got text via clipboard fallback: {} chars",
        copied_text.chars().count()
    );
    Ok(copied_text)
}

#[cfg(target_os = "macos")]
fn get_clipboard_change_count() -> isize {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send, msg_send_id};

    unsafe {
        let cls = class!(NSPasteboard);
        let pasteboard: Option<Retained<AnyObject>> = msg_send_id![cls, generalPasteboard];
        match pasteboard {
            Some(pasteboard) => msg_send![&*pasteboard, changeCount],
            None => 0,
        }
    }
}

/// Get cursor context from the active application (A2 editable snapshot).
/// On macOS, snapshots the focused editable element via `ax_snapshot` and
/// splits at the caret; failures surface as stable `SnapshotStatus` codes.
/// On other platforms, returns Err (not supported).
pub fn get_cursor_context(_app_handle: &AppHandle) -> Result<CursorContext, String> {
    #[cfg(target_os = "macos")]
    {
        match crate::ax_snapshot::snapshot_focused_editor() {
            Ok(snap) => {
                let (before_text, after_text) = snap.split_at_cursor();
                let before = truncate_before(&before_text, CURSOR_CONTEXT_BEFORE_LIMIT);
                let after = truncate_after(&after_text, CURSOR_CONTEXT_AFTER_LIMIT);
                if before.is_empty() && after.is_empty() {
                    log::debug!("[CursorContext] snapshot ok but context empty");
                    return Err(crate::ax_snapshot::SnapshotStatus::ValueUnavailable
                        .code()
                        .to_string());
                }
                info!(
                    "[CursorContext] snapshot ok: role={} id={} before={}chars after={}chars",
                    snap.role,
                    snap.element_id,
                    before.chars().count(),
                    after.chars().count()
                );
                Ok(CursorContext { before, after })
            }
            Err(status) => {
                log::debug!("[CursorContext] snapshot failed: {}", status.code());
                Err(status.code().to_string())
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(crate::ax_snapshot::SnapshotStatus::NativeUnavailable
            .code()
            .to_string())
    }
}

/// Text surrounding the cursor position in the active editor.
#[derive(Debug, Clone)]
pub struct CursorContext {
    /// Text before the cursor (up to 300 chars, truncated at sentence/paragraph boundary).
    pub before: String,
    /// Text after the cursor (up to 100 chars, truncated at sentence/paragraph boundary).
    pub after: String,
}

const CURSOR_CONTEXT_BEFORE_LIMIT: usize = 300;
const CURSOR_CONTEXT_AFTER_LIMIT: usize = 100;

/// Truncate text to at most `limit` characters from the END, preferring to cut
/// at sentence/paragraph boundaries (newline, period, exclamation, question mark).
fn truncate_before(text: &str, limit: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= limit {
        return text.to_string();
    }

    let start = chars.len() - limit;
    let slice = &chars[start..];

    // Look for a boundary in the first 30% of the slice to avoid cutting too much
    let search_range = (limit * 3) / 10;
    let boundary_chars = ['\n', '。', '！', '？', '.', '!', '?'];

    for i in 0..search_range.min(slice.len()) {
        if boundary_chars.contains(&slice[i]) {
            // Start after the boundary character (skip whitespace too)
            let mut j = i + 1;
            while j < slice.len() && slice[j].is_whitespace() {
                j += 1;
            }
            if j < slice.len() {
                return slice[j..].iter().collect();
            }
        }
    }

    // No sentence boundary found — try space/CJK boundary
    for i in 0..search_range.min(slice.len()) {
        if slice[i].is_whitespace() {
            let mut j = i + 1;
            while j < slice.len() && slice[j].is_whitespace() {
                j += 1;
            }
            if j < slice.len() {
                return slice[j..].iter().collect();
            }
        }
    }

    // Hard truncate
    slice.iter().collect()
}

/// Truncate text to at most `limit` characters from the START, preferring to cut
/// at sentence/paragraph boundaries.
fn truncate_after(text: &str, limit: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= limit {
        return text.to_string();
    }

    let slice = &chars[..limit];
    let boundary_chars = ['\n', '。', '！', '？', '.', '!', '?'];

    // Search from the end of the slice backwards, within last 30%
    let search_start = limit - (limit * 3) / 10;
    for i in (search_start..slice.len()).rev() {
        if boundary_chars.contains(&slice[i]) {
            return slice[..=i].iter().collect();
        }
    }

    // No sentence boundary — try space
    for i in (search_start..slice.len()).rev() {
        if slice[i].is_whitespace() {
            return slice[..i].iter().collect();
        }
    }

    // Hard truncate
    slice.iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{AppProfile, AppReviewPolicy};

    fn test_settings_with_profile(
        app_name: &str,
        disable_selection_clipboard_fallback: bool,
    ) -> AppSettings {
        let mut settings = crate::settings::get_default_settings();
        let profile_id = "profile_codex".to_string();
        settings
            .app_to_profile
            .insert(app_name.to_string(), profile_id.clone());
        settings.app_profiles.push(AppProfile {
            id: profile_id,
            name: app_name.to_string(),
            policy: AppReviewPolicy::Always,
            prompt_id: None,
            icon: None,
            translate_to_english_on_insert: false,
            disable_selection_clipboard_fallback,
            rules: Vec::new(),
        });
        settings
    }

    #[test]
    fn test_truncate_before_at_sentence_boundary() {
        let text = "First sentence. Second sentence. Third sentence here.";
        let result = truncate_before(text, 30);
        // slice = chars[23..] = "sentence. Third sentence here."
        // boundary '.' found at index 8, skip space at 9, return from index 10
        assert_eq!(result, "Third sentence here.");
    }

    #[test]
    fn test_truncate_before_no_boundary() {
        let text = "abcdefghijklmnopqrstuvwxyz";
        let result = truncate_before(text, 10);
        assert_eq!(result.chars().count(), 10);
    }

    #[test]
    fn test_truncate_after_at_sentence_boundary() {
        let text = "First sentence. Second sentence. Third.";
        let result = truncate_after(text, 20);
        assert_eq!(result, "First sentence.");
    }

    #[test]
    fn test_truncate_after_no_boundary() {
        let text = "abcdefghijklmnopqrstuvwxyz";
        let result = truncate_after(text, 10);
        assert_eq!(result.chars().count(), 10);
    }

    #[test]
    fn test_truncate_before_empty() {
        assert_eq!(truncate_before("", 300), "");
    }

    #[test]
    fn test_truncate_after_empty() {
        assert_eq!(truncate_after("", 100), "");
    }

    #[test]
    fn test_truncate_before_paragraph_boundary() {
        let text = "Line one.\nLine two.\nLine three.";
        let result = truncate_before(text, 15);
        // Should find the newline boundary
        assert!(result.starts_with("Line two.") || result.starts_with("Line three."));
    }

    #[test]
    fn test_truncate_before_shorter_than_limit() {
        let text = "Short text.";
        let result = truncate_before(text, 300);
        assert_eq!(result, "Short text.");
    }

    #[test]
    fn test_truncate_after_shorter_than_limit() {
        let text = "Short text.";
        let result = truncate_after(text, 100);
        assert_eq!(result, "Short text.");
    }

    #[test]
    fn auto_submit_requires_setting_enabled() {
        assert!(!should_send_auto_submit(false, PasteMethod::CtrlV));
        assert!(!should_send_auto_submit(false, PasteMethod::Direct));
    }

    #[test]
    fn auto_submit_skips_none_paste_method() {
        assert!(!should_send_auto_submit(true, PasteMethod::None));
    }

    #[test]
    fn auto_submit_runs_for_active_paste_methods() {
        assert!(should_send_auto_submit(true, PasteMethod::CtrlV));
        assert!(should_send_auto_submit(true, PasteMethod::Direct));
        assert!(should_send_auto_submit(true, PasteMethod::CtrlShiftV));
    }

    #[test]
    fn selection_clipboard_fallback_enabled_by_default_for_unmatched_app() {
        let settings = crate::settings::get_default_settings();
        assert!(should_use_selection_clipboard_fallback(
            &settings,
            Some("Codex")
        ));
    }

    #[test]
    fn selection_clipboard_fallback_respects_app_profile_disable_flag() {
        let settings = test_settings_with_profile("Codex", true);
        assert!(!should_use_selection_clipboard_fallback(
            &settings,
            Some("Codex")
        ));
    }

    #[test]
    fn selection_clipboard_fallback_remains_enabled_when_profile_allows_it() {
        let settings = test_settings_with_profile("Codex", false);
        assert!(should_use_selection_clipboard_fallback(
            &settings,
            Some("Codex")
        ));
    }

    #[test]
    fn selection_clipboard_fallback_disabled_for_terminal_apps() {
        let settings = crate::settings::get_default_settings();
        assert!(!should_use_selection_clipboard_fallback(
            &settings,
            Some("Ghostty")
        ));
        assert!(!should_use_selection_clipboard_fallback(
            &settings,
            Some("iTerm2")
        ));
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn auto_submit_runs_for_active_paste_methods_shift_insert() {
        assert!(should_send_auto_submit(true, PasteMethod::ShiftInsert));
    }
}
