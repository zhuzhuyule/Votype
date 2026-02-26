use enigo::{Enigo, Key, Keyboard, Mouse, Settings};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Wrapper for Enigo to store in Tauri's managed state.
/// Enigo is wrapped in a Mutex since it requires mutable access.
/// Uses Option to support lazy initialization - Enigo is only created when first needed.
pub struct EnigoState(pub Mutex<Option<Enigo>>);

impl EnigoState {
    /// Create a new EnigoState without initializing Enigo.
    /// Enigo will be initialized on first use via get_or_init().
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// Get a mutable reference to Enigo, initializing it if needed.
    /// Returns an error if initialization fails (e.g., no Accessibility permission).
    pub fn get_or_init(&self) -> Result<std::sync::MutexGuard<'_, Option<Enigo>>, String> {
        let mut enigo_opt = self
            .0
            .lock()
            .map_err(|e| format!("Failed to lock Enigo state: {}", e))?;

        if enigo_opt.is_none() {
            // First use - initialize Enigo
            let enigo = Enigo::new(&Settings::default()).map_err(|e| {
                format!(
                    "Failed to initialize input system. \
                    Please grant Accessibility permission in System Settings → \
                    Privacy & Security → Accessibility. Error: {}",
                    e
                )
            })?;
            *enigo_opt = Some(enigo);
        }

        Ok(enigo_opt)
    }
}

/// Get the current mouse cursor position using the managed Enigo instance.
/// Returns None if the state is not available or if getting the location fails.
/// Enigo will be initialized on first call if not already initialized.
pub fn get_cursor_position(app_handle: &AppHandle) -> Option<(i32, i32)> {
    let enigo_state = app_handle.try_state::<EnigoState>()?;
    // If Enigo initialization fails, return None (overlay will use default position)
    let mut enigo_opt = enigo_state.get_or_init().ok()?;
    enigo_opt.as_mut()?.location().ok()
}

/// Sends a Ctrl+V or Cmd+V paste command using platform-specific virtual key codes.
/// This ensures the paste works regardless of keyboard layout (e.g., Russian, AZERTY, DVORAK).
/// Note: On Wayland, this may not work - callers should check for Wayland and use alternative methods.
pub fn send_paste_ctrl_v(enigo: &mut Enigo) -> Result<(), String> {
    // Platform-specific key definitions
    #[cfg(target_os = "macos")]
    let (modifier_key, v_key_code) = (Key::Meta, Key::Other(9));
    #[cfg(target_os = "windows")]
    let (modifier_key, v_key_code) = (Key::Control, Key::Other(0x56)); // VK_V
    #[cfg(target_os = "linux")]
    let (modifier_key, v_key_code) = (Key::Control, Key::Unicode('v'));

    // Press modifier + V
    enigo
        .key(modifier_key, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press modifier key: {}", e))?;
    enigo
        .key(v_key_code, enigo::Direction::Click)
        .map_err(|e| format!("Failed to click V key: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(100));

    enigo
        .key(modifier_key, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release modifier key: {}", e))?;

    Ok(())
}

/// Sends a Cmd+C copy command (macOS only).
/// Used to copy the currently selected text to clipboard.
#[cfg(target_os = "macos")]
pub fn send_copy_cmd_c(enigo: &mut Enigo) -> Result<(), String> {
    let (modifier_key, c_key_code) = (Key::Meta, Key::Other(8)); // Cmd+C on macOS

    // Press Cmd + C
    enigo
        .key(modifier_key, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press Cmd key: {}", e))?;
    enigo
        .key(c_key_code, enigo::Direction::Click)
        .map_err(|e| format!("Failed to click C key: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(50));

    enigo
        .key(modifier_key, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release Cmd key: {}", e))?;

    Ok(())
}

/// Sends a Ctrl+C copy command (Windows and Linux).
/// Used to copy the currently selected text to clipboard.
#[cfg(not(target_os = "macos"))]
pub fn send_copy_ctrl_c(enigo: &mut Enigo) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let (modifier_key, c_key_code) = (Key::Control, Key::Other(0x43)); // VK_C
    #[cfg(target_os = "linux")]
    let (modifier_key, c_key_code) = (Key::Control, Key::Unicode('c'));

    // Press Ctrl + C
    enigo
        .key(modifier_key, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press Ctrl key: {}", e))?;
    enigo
        .key(c_key_code, enigo::Direction::Click)
        .map_err(|e| format!("Failed to click C key: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(50));

    enigo
        .key(modifier_key, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release Ctrl key: {}", e))?;

    Ok(())
}

/// Sends a Ctrl+Shift+V paste command.
/// This is commonly used in terminal applications on Linux to paste without formatting.
/// Note: On Wayland, this may not work - callers should check for Wayland and use alternative methods.
pub fn send_paste_ctrl_shift_v(enigo: &mut Enigo) -> Result<(), String> {
    // Platform-specific key definitions
    #[cfg(target_os = "macos")]
    let (modifier_key, v_key_code) = (Key::Meta, Key::Other(9)); // Cmd+Shift+V on macOS
    #[cfg(target_os = "windows")]
    let (modifier_key, v_key_code) = (Key::Control, Key::Other(0x56)); // VK_V
    #[cfg(target_os = "linux")]
    let (modifier_key, v_key_code) = (Key::Control, Key::Unicode('v'));

    // Press Ctrl/Cmd + Shift + V
    enigo
        .key(modifier_key, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press modifier key: {}", e))?;
    enigo
        .key(Key::Shift, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press Shift key: {}", e))?;
    enigo
        .key(v_key_code, enigo::Direction::Click)
        .map_err(|e| format!("Failed to click V key: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(100));

    enigo
        .key(Key::Shift, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release Shift key: {}", e))?;
    enigo
        .key(modifier_key, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release modifier key: {}", e))?;

    Ok(())
}

/// Sends a Shift+Insert paste command (Windows and Linux only).
/// This is more universal for terminal applications and legacy software.
/// Note: On Wayland, this may not work - callers should check for Wayland and use alternative methods.
#[cfg(not(target_os = "macos"))]
pub fn send_paste_shift_insert(enigo: &mut Enigo) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let insert_key_code = Key::Other(0x2D); // VK_INSERT
    #[cfg(not(target_os = "windows"))]
    let insert_key_code = Key::Other(0x76); // XK_Insert (keycode 118 / 0x76, also used as fallback)

    // Press Shift + Insert
    enigo
        .key(Key::Shift, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press Shift key: {}", e))?;
    enigo
        .key(insert_key_code, enigo::Direction::Click)
        .map_err(|e| format!("Failed to click Insert key: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(100));

    enigo
        .key(Key::Shift, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release Shift key: {}", e))?;

    Ok(())
}

/// Pastes text directly using the enigo text method.
/// This tries to use system input methods if possible, otherwise simulates keystrokes one by one.
/// For multi-line text, sends each line separately with a delay to avoid ordering issues.
pub fn paste_text_direct(enigo: &mut Enigo, text: &str) -> Result<(), String> {
    // Check if text contains newlines
    if text.contains('\n') {
        // Split by newlines and send each part separately
        let lines: Vec<&str> = text.split('\n').collect();
        for (i, line) in lines.iter().enumerate() {
            if !line.is_empty() {
                enigo
                    .text(line)
                    .map_err(|e| format!("Failed to send text directly: {}", e))?;
            }
            // If not the last line, send Shift+Return for soft newline (avoids submit in chat apps)
            if i < lines.len() - 1 {
                std::thread::sleep(std::time::Duration::from_millis(10));
                enigo
                    .key(Key::Shift, enigo::Direction::Press)
                    .map_err(|e| format!("Failed to press Shift: {}", e))?;
                enigo
                    .key(Key::Return, enigo::Direction::Click)
                    .map_err(|e| format!("Failed to send Return key: {}", e))?;
                enigo
                    .key(Key::Shift, enigo::Direction::Release)
                    .map_err(|e| format!("Failed to release Shift: {}", e))?;
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    } else {
        // No newlines, send directly
        enigo
            .text(text)
            .map_err(|e| format!("Failed to send text directly: {}", e))?;
    }

    Ok(())
}

/// Executes an external script to perform the paste operation.
/// The script is passed the text to paste as its first argument.
pub fn paste_text_external(
    _enigo: &mut enigo::Enigo,
    text: &str,
    script_path: &str,
    _app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    use std::process::Command;

    if script_path.is_empty() {
        return Err("External script path is empty".to_string());
    }

    log::info!(
        "Executing external paste script: {} with text length {}",
        script_path,
        text.len()
    );

    let output = Command::new(script_path)
        .arg(text)
        .output()
        .map_err(|e| format!("Failed to execute external script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "External script failed with status {}: {}",
            output.status, stderr
        ));
    }

    Ok(())
}
