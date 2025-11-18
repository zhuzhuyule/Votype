use active_win_pos_rs::{get_active_window, WindowPosition as RawWindowPosition};
use enigo::{Enigo, Mouse, Settings};
use serde::Serialize;

/// Lightweight serializable representation of the active window's bounds.
#[derive(Debug, Serialize)]
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
#[derive(Debug, Serialize)]
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
