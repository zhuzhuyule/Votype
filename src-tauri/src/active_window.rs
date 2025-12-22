use active_win_pos_rs::{get_active_window, WindowPosition as RawWindowPosition};
use enigo::{Enigo, Mouse, Settings};
use serde::Serialize;

/// Lightweight serializable representation of the active window's bounds.
#[derive(Debug, Serialize, Clone)]
pub struct WindowPosition {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl From<RawWindowPosition> for WindowPosition {
    fn from(value: RawWindowPosition) -> Self {
        Self {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
        }
    }
}

/// Snapshot of the currently focused application's main window.
#[derive(Debug, Serialize, Clone)]
pub struct ActiveWindowInfo {
    pub title: String,
    pub app_name: String,
    pub window_id: String,
    pub process_id: u64,
    pub process_path: String,
    pub position: WindowPosition,
}

#[derive(Debug, Serialize)]
pub struct CursorPosition {
    pub x: i32,
    pub y: i32,
}

pub fn fetch_active_window() -> Result<ActiveWindowInfo, String> {
    let active_window =
        get_active_window().map_err(|_| "无法获取当前活动窗口，可能缺少辅助权限".to_string())?;

    Ok(ActiveWindowInfo {
        title: active_window.title,
        app_name: active_window.app_name,
        window_id: active_window.window_id,
        process_id: active_window.process_id,
        process_path: active_window.process_path.to_string_lossy().to_string(),
        position: active_window.position.into(),
    })
}

pub fn fetch_cursor_position() -> Result<CursorPosition, String> {
    let enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 实例失败: {}", e))?;
    let location = enigo
        .location()
        .map_err(|e| format!("无法获取鼠标位置: {}", e))?;
    Ok(CursorPosition {
        x: location.0,
        y: location.1,
    })
}

#[cfg(target_os = "macos")]
pub fn focus_app_by_pid(pid: u64) -> Result<(), String> {
    use std::process::Command;
    let script = format!(
        r#"tell application "System Events" to set frontmost of (first process whose unix id is {pid}) to true"#
    );
    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|e| format!("Failed to run osascript: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Failed to activate previous app".to_string())
    }
}

#[cfg(target_os = "windows")]
pub fn focus_app_by_pid(pid: u64) -> Result<(), String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, ShowWindow,
        SW_RESTORE,
    };

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let target = &mut *(lparam.0 as *mut WindowSearch);
        if !target.hwnd.is_invalid() {
            return BOOL(0);
        }

        let mut window_pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
        if window_pid as u64 == target.pid && IsWindowVisible(hwnd).as_bool() {
            target.hwnd = hwnd;
            return BOOL(0);
        }

        BOOL(1)
    }

    #[derive(Default)]
    struct WindowSearch {
        pid: u64,
        hwnd: HWND,
    }

    let mut search = WindowSearch {
        pid,
        hwnd: HWND::default(),
    };

    unsafe {
        let lparam = LPARAM(&mut search as *mut WindowSearch as isize);
        EnumWindows(Some(enum_windows_proc), lparam);
    }

    if search.hwnd.is_invalid() {
        return Err("No window found for target pid".to_string());
    }

    unsafe {
        ShowWindow(search.hwnd, SW_RESTORE);
        if SetForegroundWindow(search.hwnd).as_bool() {
            Ok(())
        } else {
            Err("Failed to bring window to foreground".to_string())
        }
    }
}

#[cfg(target_os = "linux")]
pub fn focus_app_by_pid(pid: u64) -> Result<(), String> {
    use crate::utils::is_wayland;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ClientMessageData, ClientMessageEvent, ConnectionExt, EventMask, PropMode, Window,
    };

    if is_wayland() {
        return focus_previous_app_wayland();
    }
    if std::env::var("DISPLAY").is_err() {
        return Err("DISPLAY is not set; likely running under Wayland".to_string());
    }

    let (conn, screen_num) = x11rb::connect(None).map_err(|e| e.to_string())?;
    let root = conn.setup().roots[screen_num].root;

    let atom_pid = conn
        .intern_atom(false, b"_NET_WM_PID")
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?
        .atom;
    let atom_active = conn
        .intern_atom(false, b"_NET_ACTIVE_WINDOW")
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?
        .atom;

    let tree = conn
        .query_tree(root)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?;

    let mut target_window: Option<Window> = None;
    for win in tree.children {
        let prop = conn
            .get_property(false, win, atom_pid, AtomEnum::CARDINAL, 0, 1)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        if let Some(value) = prop.value32().and_then(|mut v| v.next()) {
            if value as u64 == pid {
                target_window = Some(win);
                break;
            }
        }
    }

    let target = target_window.ok_or_else(|| "No X11 window found for pid".to_string())?;

    let event = ClientMessageEvent {
        response_type: 33,
        format: 32,
        sequence: 0,
        window: target,
        type_: atom_active,
        data: ClientMessageData::from([1, 0, 0, 0, 0]),
    };

    conn.send_event(
        false,
        root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        event,
    )
    .map_err(|e| e.to_string())?;
    conn.flush().map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn focus_previous_app_wayland() -> Result<(), String> {
    use std::process::Command;

    if is_wtype_available() {
        let output = Command::new("wtype")
            .args(["-M", "alt", "-k", "Tab", "-m", "alt"])
            .output()
            .map_err(|e| format!("Failed to execute wtype: {}", e))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("wtype failed: {}", stderr));
    }

    if is_dotool_available() {
        let output = Command::new("sh")
            .arg("-c")
            .arg("echo key alt+tab | dotool")
            .output()
            .map_err(|e| format!("Failed to execute dotool: {}", e))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("dotool failed: {}", stderr));
    }

    Err("Wayland focus requires wtype or dotool".to_string())
}

#[cfg(target_os = "linux")]
fn is_wtype_available() -> bool {
    std::process::Command::new("which")
        .arg("wtype")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn is_dotool_available() -> bool {
    std::process::Command::new("which")
        .arg("dotool")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(all(
    not(target_os = "macos"),
    not(target_os = "windows"),
    not(target_os = "linux")
))]
pub fn focus_app_by_pid(_pid: u64) -> Result<(), String> {
    Err("Focus by pid is not supported on this platform".to_string())
}
