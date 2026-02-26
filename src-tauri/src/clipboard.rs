use crate::input::{self, EnigoState};
use crate::settings::{get_settings, AutoSubmitKey, ClipboardHandling, PasteMethod};
use enigo::{Direction, Enigo, Key, Keyboard};
use log::info;
use std::time::Duration;
use tauri::{AppHandle, Manager};
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
/// On macOS, tries Accessibility API first, falls back to clipboard method.
/// On other platforms, uses clipboard method.
pub fn get_selected_text(app_handle: &AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // Try Accessibility API first
        match get_selected_text_via_accessibility() {
            Ok(text) if !text.is_empty() => {
                info!(
                    "[Selection] Got text via Accessibility API: {} chars",
                    text.len()
                );
                return Ok(text);
            }
            Ok(_) => {
                info!("[Selection] Accessibility API returned empty, trying clipboard method");
            }
            Err(e) => {
                info!(
                    "[Selection] Accessibility API failed ({}), trying clipboard method",
                    e
                );
            }
        }
    }

    // Fallback: use clipboard method
    get_selected_text_via_clipboard(app_handle)
}

/// Get selected text using the clipboard method:
/// 1. Save current clipboard content
/// 2. Send Cmd+C / Ctrl+C to copy selection
/// 3. Read clipboard content
/// 4. Restore original clipboard content
fn get_selected_text_via_clipboard(app_handle: &AppHandle) -> Result<String, String> {
    let clipboard = app_handle.clipboard();

    // Save current clipboard content
    let original_content = clipboard.read_text().unwrap_or_default();

    // Clear clipboard to detect if copy succeeded
    clipboard
        .write_text("")
        .map_err(|e| format!("Failed to clear clipboard: {}", e))?;

    // Get enigo for sending keystrokes
    let enigo_state = app_handle
        .try_state::<EnigoState>()
        .ok_or("Enigo state not initialized")?;
    let mut enigo_opt = enigo_state.get_or_init()?;
    let enigo = enigo_opt
        .as_mut()
        .ok_or("Failed to initialize input system")?;

    // Send copy keystroke
    #[cfg(target_os = "macos")]
    input::send_copy_cmd_c(enigo)?;
    #[cfg(not(target_os = "macos"))]
    input::send_copy_ctrl_c(enigo)?;

    // Wait for clipboard to update
    std::thread::sleep(std::time::Duration::from_millis(100));

    // Read the selected text
    let selected_text = clipboard.read_text().unwrap_or_default();

    // Restore original clipboard content
    clipboard
        .write_text(&original_content)
        .map_err(|e| format!("Failed to restore clipboard: {}", e))?;

    info!(
        "[Selection] Got text via clipboard method: {} chars",
        selected_text.len()
    );
    Ok(selected_text)
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

#[cfg(test)]
mod tests {
    use super::*;

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
    #[cfg(not(target_os = "macos"))]
    fn auto_submit_runs_for_active_paste_methods_shift_insert() {
        assert!(should_send_auto_submit(true, PasteMethod::ShiftInsert));
    }
}
