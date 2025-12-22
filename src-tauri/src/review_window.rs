// Review Window - Independent floating window for reviewing low-confidence transcriptions
// This module handles the creation, display, and lifecycle of the review window

use crate::active_window::ActiveWindowInfo;
use log::{debug, error};
use once_cell::sync::Lazy;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

const REVIEW_WINDOW_WIDTH: f64 = 500.0;
const REVIEW_WINDOW_HEIGHT: f64 = 300.0;

#[derive(Clone, serde::Serialize)]
struct ReviewWindowPayload {
    text: String,
    confidence: u8,
    history_id: Option<i64>,
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

            // Debug: show review window immediately on startup
            show_review_window(app_handle, "Review window debug".to_string(), 100, None);
        }
        Err(e) => {
            error!("Failed to create review window: {}", e);
        }
    }
}

/// Shows the review window with the provided data
pub fn show_review_window(
    app_handle: &AppHandle,
    text: String,
    confidence: u8,
    history_id: Option<i64>,
) {
    debug!(
        "show_review_window called with confidence: {}, text length: {}",
        confidence,
        text.len()
    );

    let payload = ReviewWindowPayload {
        text,
        confidence,
        history_id,
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

    let payload = {
        let pending = PENDING_REVIEW_PAYLOAD.lock().unwrap();
        pending.clone()
    };

    if let Some(payload) = payload {
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
