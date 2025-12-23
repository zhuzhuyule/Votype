// Review Window - Independent floating window for reviewing low-confidence transcriptions
// This module handles the creation, display, and lifecycle of the review window

use crate::active_window::{fetch_cursor_position, ActiveWindowInfo};
use log::{debug, error};
use once_cell::sync::Lazy;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

const REVIEW_WINDOW_WIDTH: f64 = 520.0;
const REVIEW_WINDOW_MIN_WIDTH: f64 = 480.0;
const REVIEW_WINDOW_MAX_WIDTH: f64 = 860.0;
const REVIEW_WINDOW_HEIGHT: f64 = 320.0;
const REVIEW_WINDOW_MAX_HEIGHT: f64 = 720.0;
const REVIEW_WINDOW_MARGIN: f64 = 8.0;

#[derive(Clone, serde::Serialize)]
struct ReviewWindowPayload {
    source_text: String,
    final_text: String,
    change_percent: u8,
    history_id: Option<i64>,
    reason: Option<String>,
}

static REVIEW_WINDOW_READY: AtomicBool = AtomicBool::new(false);
static PENDING_REVIEW_PAYLOAD: Lazy<Mutex<Option<ReviewWindowPayload>>> =
    Lazy::new(|| Mutex::new(None));
static LAST_REVIEW_HISTORY_ID: Lazy<Mutex<Option<i64>>> = Lazy::new(|| Mutex::new(None));
static LAST_ACTIVE_WINDOW: Lazy<Mutex<Option<ActiveWindowInfo>>> = Lazy::new(|| Mutex::new(None));

fn emit_review_payload(app_handle: &AppHandle, payload: ReviewWindowPayload) -> bool {
    if let Some(review_window) = app_handle.get_webview_window("review_window") {
        let emit_result = review_window.emit("review-window-show", payload);
        debug!("review_window.emit() result: {:?}", emit_result);
        return emit_result.is_ok();
    }

    error!("review_window not found! Window may not have been created.");
    false
}

fn estimate_line_count(text: &str, line_chars: usize) -> usize {
    let mut lines = 0usize;
    for line in text.lines() {
        let count = line.chars().count();
        let wrapped = (count / line_chars).max(1);
        lines += wrapped;
    }
    if lines == 0 {
        1
    } else {
        lines
    }
}

fn estimate_window_width(source_text: &str, final_text: &str) -> f64 {
    let max_line_len = source_text
        .lines()
        .chain(final_text.lines())
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0);
    if max_line_len == 0 {
        return REVIEW_WINDOW_WIDTH;
    }
    let estimated = (max_line_len as f64 * 9.2).min(REVIEW_WINDOW_MAX_WIDTH);
    estimated.clamp(REVIEW_WINDOW_MIN_WIDTH, REVIEW_WINDOW_MAX_WIDTH)
}

fn estimate_window_height(source_text: &str, final_text: &str, width: f64) -> f64 {
    let line_chars = (width / 9.5).floor().max(18.0) as usize;
    let source_lines = estimate_line_count(source_text, line_chars);
    let final_lines = estimate_line_count(final_text, line_chars);
    let content_lines = source_lines + final_lines;
    let content_height = content_lines as f64 * 20.0;
    let chrome_height = 180.0;
    let height = (chrome_height + content_height)
        .max(REVIEW_WINDOW_HEIGHT)
        .min(REVIEW_WINDOW_MAX_HEIGHT);
    height
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

fn find_monitor_for_cursor(
    monitors: &[tauri::Monitor],
    cursor_x: i32,
    cursor_y: i32,
) -> Option<tauri::Monitor> {
    for monitor in monitors {
        let position = monitor.position();
        let size = monitor.size();
        let left = position.x;
        let top = position.y;
        let right = left + size.width as i32;
        let bottom = top + size.height as i32;
        if cursor_x >= left && cursor_x <= right && cursor_y >= top && cursor_y <= bottom {
            return Some(monitor.clone());
        }
    }
    monitors.first().cloned()
}

fn position_window_near_cursor(window: &tauri::WebviewWindow, width: f64, height: f64) {
    let cursor = fetch_cursor_position().ok();
    let monitors = window.available_monitors().ok().unwrap_or_default();

    if let Some(cursor) = cursor {
        if let Some(monitor) = find_monitor_for_cursor(&monitors, cursor.x, cursor.y) {
            let scale = monitor.scale_factor();
            let position = monitor.position();
            let monitor_size = monitor.size();
            let cursor_x = (cursor.x - position.x) as f64 / scale;
            let cursor_y = (cursor.y - position.y) as f64 / scale;
            let max_x = monitor_size.width as f64 / scale - width - REVIEW_WINDOW_MARGIN;
            let max_y = monitor_size.height as f64 / scale - height - REVIEW_WINDOW_MARGIN;
            let x = clamp(cursor_x - width * 0.5, REVIEW_WINDOW_MARGIN, max_x)
                + position.x as f64 / scale;
            let y = clamp(cursor_y - 40.0, REVIEW_WINDOW_MARGIN, max_y) + position.y as f64 / scale;
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }
    }
}

/// Creates the review window and keeps it hidden by default
pub fn create_review_window(app_handle: &AppHandle) {
    match tauri::WebviewWindowBuilder::new(
        app_handle,
        "review_window",
        tauri::WebviewUrl::App("src/review/index.html".into()),
    )
    .title("Votype Review")
    .resizable(true)
    .inner_size(REVIEW_WINDOW_WIDTH, REVIEW_WINDOW_HEIGHT)
    .shadow(true)
    .min_inner_size(REVIEW_WINDOW_WIDTH, REVIEW_WINDOW_HEIGHT)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .visible(false)
    .accept_first_mouse(true)
    .focused(true)
    .build()
    {
        Ok(window) => {
            // Center the window on the primary monitor
            if let Some(monitor) = window.primary_monitor().ok().flatten() {
                let screen_size = monitor.size();
                let scale = monitor.scale_factor();
                let x = (screen_size.width as f64 / scale - REVIEW_WINDOW_WIDTH) / 2.0;
                let y = (screen_size.height as f64 / scale - REVIEW_WINDOW_HEIGHT) / 2.0;
                let _ =
                    window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            }
            debug!("Review window created successfully (hidden)");

            // Warm up the window to avoid focus stealing on first show.
            let _ = window.show();
            let _ = window.hide();
        }
        Err(e) => {
            error!("Failed to create review window: {}", e);
        }
    }
}

/// Shows the review window with the provided data
pub fn show_review_window(
    app_handle: &AppHandle,
    source_text: String,
    final_text: String,
    change_percent: u8,
    history_id: Option<i64>,
    reason: Option<String>,
) {
    debug!(
        "show_review_window called with change_percent: {}, text length: {}",
        change_percent,
        final_text.len()
    );
    let preview: String = final_text.chars().take(80).collect();
    log::info!(
        "review_window payload: history_id={:?}, change_percent={}, preview=\"{}\"",
        history_id,
        change_percent,
        preview
    );

    let source_for_layout = source_text.clone();
    let final_for_layout = final_text.clone();

    let payload = ReviewWindowPayload {
        source_text,
        final_text,
        change_percent,
        history_id,
        reason,
    };

    {
        let mut pending = PENDING_REVIEW_PAYLOAD.lock().unwrap();
        *pending = Some(payload.clone());
    }
    {
        let mut last_id = LAST_REVIEW_HISTORY_ID.lock().unwrap();
        *last_id = history_id;
    }

    if let Some(review_window) = app_handle.get_webview_window("review_window") {
        debug!("Found review_window, emitting event and showing...");

        let width = estimate_window_width(&source_for_layout, &final_for_layout);
        let height = estimate_window_height(&source_for_layout, &final_for_layout, width);
        let _ = review_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        position_window_near_cursor(&review_window, width, height);

        // Show the window first
        let show_result = review_window.show();
        debug!("review_window.show() result: {:?}", show_result);
        let focus_result = review_window.set_focus();
        debug!("review_window.set_focus() result: {:?}", focus_result);

        if REVIEW_WINDOW_READY.load(Ordering::SeqCst) {
            if emit_review_payload(app_handle, payload) {
                let mut pending = PENDING_REVIEW_PAYLOAD.lock().unwrap();
                *pending = None;
            }
        }
    }
}

/// Hides the review window
pub fn hide_review_window(app_handle: &AppHandle) {
    if let Some(review_window) = app_handle.get_webview_window("review_window") {
        let _ = review_window.emit("review-window-hide", ());
        let _ = review_window.hide();
    }
}

#[tauri::command]
pub fn review_window_ready(app: AppHandle) -> Result<(), String> {
    REVIEW_WINDOW_READY.store(true, Ordering::SeqCst);
    log::info!("review_window_ready received");

    let payload = {
        let pending = PENDING_REVIEW_PAYLOAD.lock().unwrap();
        pending.clone()
    };

    if let Some(payload) = payload {
        log::info!(
            "review_window_ready replaying payload: history_id={:?}, change_percent={}",
            payload.history_id,
            payload.change_percent
        );
        if emit_review_payload(&app, payload) {
            let mut pending = PENDING_REVIEW_PAYLOAD.lock().unwrap();
            *pending = None;
        }
    }

    Ok(())
}

pub fn get_last_review_history_id() -> Option<i64> {
    let last_id = LAST_REVIEW_HISTORY_ID.lock().unwrap();
    *last_id
}

pub fn set_last_active_window(info: Option<ActiveWindowInfo>) {
    let mut last_window = LAST_ACTIVE_WINDOW.lock().unwrap();
    *last_window = info;
}

pub fn get_last_active_window() -> Option<ActiveWindowInfo> {
    let last_window = LAST_ACTIVE_WINDOW.lock().unwrap();
    last_window.clone()
}
