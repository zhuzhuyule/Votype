// Review Window - Independent floating window for reviewing low-confidence transcriptions
// This module handles the creation, display, and lifecycle of the review window

use crate::active_window::ActiveWindowInfo;
use crate::settings::PromptOutputMode;
use log::{debug, error};
use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const REVIEW_WINDOW_WIDTH: f64 = 540.0;
const REVIEW_WINDOW_MIN_WIDTH: f64 = 600.0;
const REVIEW_WINDOW_MAX_WIDTH: f64 = 1080.0;
const REVIEW_WINDOW_HEIGHT: f64 = 480.0;
const REVIEW_WINDOW_MIN_HEIGHT: f64 = 450.0;
const REVIEW_WINDOW_MAX_HEIGHT: f64 = 920.0;

#[derive(Clone, serde::Serialize)]
struct ReviewWindowPayload {
    source_text: String,
    final_text: String,
    change_percent: i8,
    history_id: Option<i64>,
    reason: Option<String>,
    output_mode: PromptOutputMode,
    skill_name: Option<String>,
    /// The prompt_id that was actually used for this transcription (may be overridden by app rules)
    prompt_id: Option<String>,
    /// The model_id that was actually used for this transcription
    model_id: Option<String>,
}

/// Multi-model post-processing candidate result
#[derive(Clone, serde::Serialize)]
pub struct MultiModelCandidate {
    pub id: String,
    pub label: String,
    pub provider_label: String,
    pub text: String,
    pub confidence: Option<u8>,
    pub processing_time_ms: u64,
    pub error: Option<String>,
    pub ready: bool,
}

/// Review window payload for multi-candidate mode
#[allow(dead_code)]
#[derive(Clone, serde::Serialize)]
pub struct ReviewWindowMultiCandidatePayload {
    pub source_text: String,
    pub candidates: Vec<MultiModelCandidate>,
    pub history_id: Option<i64>,
    pub output_mode: PromptOutputMode,
    pub skill_name: Option<String>,
    /// The prompt_id that was actually used for this transcription (may be overridden by app rules)
    pub prompt_id: Option<String>,
    /// ID of the candidate that should be pre-selected (strategy-dependent).
    pub auto_selected_id: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[allow(dead_code)]
struct ReviewWindowHidePayload {
    history_id: Option<i64>,
}

static REVIEW_WINDOW_READY: AtomicBool = AtomicBool::new(false);
static REVIEW_WINDOW_FORCED_ACTIVATION: AtomicBool = AtomicBool::new(false);
static REVIEW_WINDOW_FOCUS_TOKEN: AtomicU64 = AtomicU64::new(0);
static REVIEW_WINDOW_ACTIVE: AtomicBool = AtomicBool::new(false);
static HIDDEN_WINDOWS_BEFORE_REVIEW: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));
static PENDING_REVIEW_PAYLOAD: Lazy<Mutex<Option<ReviewWindowPayload>>> =
    Lazy::new(|| Mutex::new(None));
static LAST_REVIEW_PAYLOAD: Lazy<Mutex<Option<ReviewWindowPayload>>> =
    Lazy::new(|| Mutex::new(None));
static LAST_REVIEW_HISTORY_ID: Lazy<Mutex<Option<i64>>> = Lazy::new(|| Mutex::new(None));
static LAST_ACTIVE_WINDOW: Lazy<Mutex<Option<ActiveWindowInfo>>> = Lazy::new(|| Mutex::new(None));
static REVIEW_EDITOR_ACTIVE: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));
static REVIEW_EDITOR_CONTENT: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static FROZEN_REVIEW_EDITOR_CONTENT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Role in a rewrite conversation turn.
#[derive(Clone, Debug)]
pub enum RewriteRole {
    User,
    Assistant,
}

/// A single message in the rewrite conversation history.
#[derive(Clone, Debug)]
pub struct RewriteMessage {
    pub role: RewriteRole,
    pub content: String,
}

/// Session-scoped conversation history for multi-turn voice rewrite.
struct RewriteConversation {
    session_id: u64,
    messages: Vec<RewriteMessage>,
}

static REWRITE_SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);
static REWRITE_CONVERSATION: Lazy<Mutex<RewriteConversation>> = Lazy::new(|| {
    Mutex::new(RewriteConversation {
        session_id: 0,
        messages: Vec::new(),
    })
});

fn emit_review_payload(app_handle: &AppHandle, payload: ReviewWindowPayload) -> bool {
    if let Some(review_window) = app_handle.get_webview_window("review_window") {
        let emit_result = review_window.emit("review-window-show", payload);
        debug!("review_window.emit() result: {:?}", emit_result);
        if emit_result.is_ok() {
            REVIEW_WINDOW_ACTIVE.store(true, Ordering::SeqCst);
            return true;
        }
        return false;
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
    let estimated = (max_line_len as f64 * 9.2 + 70.0).min(REVIEW_WINDOW_MAX_WIDTH);
    estimated.clamp(REVIEW_WINDOW_MIN_WIDTH, REVIEW_WINDOW_MAX_WIDTH)
}

fn estimate_window_height(source_text: &str, final_text: &str, width: f64) -> f64 {
    let text_width = (width - 70.0).max(200.0); // subtract panel margins
    let line_chars = (text_width / 9.2).floor().max(18.0) as usize;
    let source_lines = estimate_line_count(source_text, line_chars);
    let final_lines = estimate_line_count(final_text, line_chars);

    // Source inline frame: padding(14) + body(lines*20, max 120) + border(2)
    let source_body = (source_lines as f64 * 20.0).min(120.0);
    let source_frame = 14.0 + source_body + 2.0;
    // Output panel: header(30) + body(lines*24) + border(2)
    let output_panel = 30.0 + final_lines as f64 * 24.0 + 2.0;
    // Total: header(40) + content-padding(8) + source + gap(8) + output + footer(32)
    let total = 40.0 + 8.0 + source_frame + 8.0 + output_panel + 32.0;
    total.clamp(REVIEW_WINDOW_MIN_HEIGHT, REVIEW_WINDOW_MAX_HEIGHT)
}

fn was_app_active_before_review() -> bool {
    let pid = std::process::id() as u64;
    let last = LAST_ACTIVE_WINDOW.lock().unwrap();
    last.as_ref()
        .map(|info| info.process_id == pid)
        .unwrap_or(false)
}

fn record_hidden_windows(app_handle: &AppHandle) -> bool {
    let app_was_active = was_app_active_before_review();
    let mut hidden = HIDDEN_WINDOWS_BEFORE_REVIEW.lock().unwrap();
    hidden.clear();
    let mut any_visible = false;
    for (label, window) in app_handle.webview_windows() {
        if label == "review_window" {
            continue;
        }
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            any_visible = true;
        }
        if !app_was_active || !is_visible {
            hidden.insert(label);
        }
    }
    any_visible
}

fn schedule_hide_windows(app_handle: AppHandle) {
    let labels: Vec<String> = {
        let hidden = HIDDEN_WINDOWS_BEFORE_REVIEW.lock().unwrap();
        hidden.iter().cloned().collect()
    };
    if labels.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        for delay in [0_u64, 120, 350] {
            if delay > 0 {
                std::thread::sleep(Duration::from_millis(delay));
            }
            for label in &labels {
                if let Some(window) = app_handle.get_webview_window(label) {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }
            }
        }
    });
}

fn schedule_focus_review_window(app_handle: AppHandle, focus_token: u64) {
    std::thread::spawn(move || {
        for delay in [Duration::from_millis(120), Duration::from_millis(350)] {
            std::thread::sleep(delay);
            if let Some(window) = app_handle.get_webview_window("review_window") {
                if REVIEW_WINDOW_FOCUS_TOKEN.load(Ordering::SeqCst) != focus_token {
                    return;
                }
                if window.is_visible().unwrap_or(false) {
                    let _ = window.set_focus();
                }
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn ensure_app_active_for_review(app_handle: &AppHandle, had_visible_windows: bool) {
    if had_visible_windows {
        return;
    }
    if app_handle
        .set_activation_policy(tauri::ActivationPolicy::Regular)
        .is_ok()
    {
        REVIEW_WINDOW_FORCED_ACTIVATION.store(true, Ordering::SeqCst);
    }
}

#[allow(dead_code)]
fn maybe_restore_activation_policy(app_handle: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if !REVIEW_WINDOW_FORCED_ACTIVATION.swap(false, Ordering::SeqCst) {
            return;
        }
        let settings = crate::settings::get_settings(app_handle);
        if !settings.start_hidden {
            return;
        }
        let has_visible_windows = app_handle.webview_windows().iter().any(|(label, window)| {
            label != "review_window" && window.is_visible().unwrap_or(false)
        });
        if !has_visible_windows {
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
}

/// Get the logical size of the monitor containing the cursor (or primary).
fn get_screen_logical_size(window: &tauri::WebviewWindow) -> (f64, f64) {
    let monitor = window.primary_monitor().ok().flatten();
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let size = m.size();
        return (size.width as f64 / scale, size.height as f64 / scale);
    }
    (1440.0, 900.0) // sensible fallback
}

fn position_window_near_cursor(window: &tauri::WebviewWindow, width: f64, height: f64) {
    use crate::active_window::fetch_cursor_position;

    let mut target_monitor = None;

    // 1. Try to find the monitor containing the cursor
    if let Ok(cursor) = fetch_cursor_position() {
        if let Ok(available_monitors) = window.available_monitors() {
            for monitor in available_monitors {
                let scale = monitor.scale_factor();
                // Enigo returns logical coordinates (points), so we must compare against logical monitor bounds
                let logical_pos = monitor.position().to_logical::<f64>(scale);
                let logical_size = monitor.size().to_logical::<f64>(scale);

                let x_start = logical_pos.x;
                let y_start = logical_pos.y;
                let x_end = x_start + logical_size.width;
                let y_end = y_start + logical_size.height;

                let cx = cursor.x as f64;
                let cy = cursor.y as f64;

                if cx >= x_start && cx < x_end && cy >= y_start && cy < y_end {
                    target_monitor = Some(monitor);
                    break;
                }
            }
        }
    }

    // 2. Fallback to primary monitor if not found
    if target_monitor.is_none() {
        target_monitor = window.primary_monitor().ok().flatten();
    }

    // 3. Position the window
    if let Some(monitor) = target_monitor {
        let scale = monitor.scale_factor();
        let position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_width = monitor_size.width as f64 / scale;
        let monitor_height = monitor_size.height as f64 / scale;

        // Calculate centered position relative to the monitor's top-left
        let x = (monitor_width - width) / 2.0 + position.x as f64 / scale;
        let y = (monitor_height - height) / 2.0 + position.y as f64 / scale;

        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
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
    .min_inner_size(REVIEW_WINDOW_MIN_WIDTH, REVIEW_WINDOW_MIN_HEIGHT)
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
    change_percent: i8,
    history_id: Option<i64>,
    reason: Option<String>,
    output_mode: PromptOutputMode,
    skill_name: Option<String>,
    prompt_id: Option<String>,
    model_id: Option<String>,
) {
    REVIEW_WINDOW_ACTIVE.store(false, Ordering::SeqCst);
    reset_rewrite_conversation();
    let had_visible_windows = record_hidden_windows(app_handle);
    #[cfg(target_os = "macos")]
    ensure_app_active_for_review(app_handle, had_visible_windows);
    debug!(
        "show_review_window called with change_percent: {}, text length: {}",
        change_percent,
        final_text.len()
    );
    let preview: String = final_text.chars().take(80).collect();
    log::info!(
        "review_window payload: history_id={:?}, change_percent={}, skill={:?}, preview=\"{}\"",
        history_id,
        change_percent,
        skill_name,
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
        output_mode,
        skill_name,
        prompt_id,
        model_id,
    };

    {
        let mut pending = PENDING_REVIEW_PAYLOAD.lock().unwrap();
        *pending = Some(payload.clone());
    }
    {
        let mut last_payload = LAST_REVIEW_PAYLOAD.lock().unwrap();
        *last_payload = Some(payload.clone());
    }
    {
        let mut last_id = LAST_REVIEW_HISTORY_ID.lock().unwrap();
        *last_id = history_id;
    }

    if let Some(review_window) = app_handle.get_webview_window("review_window") {
        debug!("Found review_window, setting size/position and emitting event...");

        // Pre-calculate and set window size/position (but don't show yet)
        let width = estimate_window_width(&source_for_layout, &final_for_layout);
        let height = estimate_window_height(&source_for_layout, &final_for_layout, width);
        let _ = review_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        position_window_near_cursor(&review_window, width, height);

        // Emit event to frontend to start rendering content
        // The actual show() will be called when frontend reports content ready
        if REVIEW_WINDOW_READY.load(Ordering::SeqCst) {
            let _ = emit_review_payload(app_handle, payload);
        }

        schedule_hide_windows(app_handle.clone());
    }
}

/// Hides the review window
#[allow(dead_code)]
pub fn hide_review_window(app_handle: &AppHandle, history_id: Option<i64>) {
    if let Some(review_window) = app_handle.get_webview_window("review_window") {
        let _ = review_window.emit("review-window-hide", ReviewWindowHidePayload { history_id });
        let _ = review_window.hide();
    }
    REVIEW_WINDOW_ACTIVE.store(false, Ordering::SeqCst);
    {
        let mut pending = PENDING_REVIEW_PAYLOAD.lock().unwrap();
        *pending = None;
    }
    {
        let mut last_payload = LAST_REVIEW_PAYLOAD.lock().unwrap();
        *last_payload = None;
    }
    REVIEW_WINDOW_FOCUS_TOKEN.fetch_add(1, Ordering::SeqCst);
    schedule_hide_windows(app_handle.clone());
    maybe_restore_activation_policy(app_handle);
    reset_rewrite_conversation();
    let mut hidden = HIDDEN_WINDOWS_BEFORE_REVIEW.lock().unwrap();
    hidden.clear();
}

#[tauri::command]
pub fn review_window_ready(app: AppHandle) -> Result<(), String> {
    REVIEW_WINDOW_READY.store(true, Ordering::SeqCst);
    log::info!("review_window_ready received");

    if REVIEW_WINDOW_ACTIVE.load(Ordering::SeqCst) {
        if let Some(payload) = LAST_REVIEW_PAYLOAD.lock().unwrap().clone() {
            log::info!(
                "review_window_ready replaying payload: history_id={:?}, change_percent={}",
                payload.history_id,
                payload.change_percent
            );
            let _ = emit_review_payload(&app, payload);
        }
    }

    Ok(())
}

/// Called by frontend when content is rendered and ready to be shown
#[tauri::command]
pub fn review_window_content_ready(app: AppHandle) -> Result<(), String> {
    log::info!("review_window_content_ready received");

    if !REVIEW_WINDOW_ACTIVE.load(Ordering::SeqCst) {
        log::info!("review_window_content_ready ignored (no active payload)");
        return Ok(());
    }

    if let Some(review_window) = app.get_webview_window("review_window") {
        let focus_token = REVIEW_WINDOW_FOCUS_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;

        let show_result = review_window.show();
        debug!("review_window.show() result: {:?}", show_result);
        let focus_result = review_window.set_focus();
        debug!("review_window.set_focus() result: {:?}", focus_result);
        schedule_focus_review_window(app.clone(), focus_token);
    }

    Ok(())
}

/// Called by frontend to resize the review window after measuring actual DOM content.
/// When `reposition` is true, the window is re-centered on the cursor's monitor (initial show).
/// When false, only size changes (e.g. after prompt switch).
#[tauri::command]
pub fn resize_review_window(
    app: AppHandle,
    width: f64,
    height: f64,
    reposition: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("review_window") {
        let w = width.clamp(REVIEW_WINDOW_MIN_WIDTH, REVIEW_WINDOW_MAX_WIDTH);
        let h = height.clamp(REVIEW_WINDOW_MIN_HEIGHT, REVIEW_WINDOW_MAX_HEIGHT);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: w,
            height: h,
        }));
        if reposition {
            position_window_near_cursor(&window, w, h);
        }
    }
    Ok(())
}

#[allow(dead_code)]
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

pub fn is_review_window_active() -> bool {
    REVIEW_WINDOW_ACTIVE.load(Ordering::SeqCst)
}

pub fn set_review_editor_active(active: bool) {
    if let Ok(mut guard) = REVIEW_EDITOR_ACTIVE.lock() {
        *guard = active;
    }
}

pub fn is_review_editor_active() -> bool {
    REVIEW_EDITOR_ACTIVE
        .lock()
        .map(|guard| *guard)
        .unwrap_or(false)
}

pub fn set_review_editor_content(text: String) {
    if let Ok(mut guard) = REVIEW_EDITOR_CONTENT.lock() {
        *guard = text;
    }
}

pub fn current_review_editor_content() -> Option<String> {
    REVIEW_EDITOR_CONTENT
        .lock()
        .ok()
        .map(|guard| guard.trim().to_string())
        .filter(|text| !text.is_empty())
}

pub fn freeze_review_editor_content_snapshot() {
    let snapshot = current_review_editor_content();
    debug!(
        "[ReviewWindow] freeze_snapshot: content_len={:?}",
        snapshot.as_ref().map(|s| s.len())
    );
    if let Ok(mut guard) = FROZEN_REVIEW_EDITOR_CONTENT.lock() {
        *guard = snapshot;
    }
}

pub fn take_frozen_review_editor_content() -> Option<String> {
    FROZEN_REVIEW_EDITOR_CONTENT
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
}

/// Get the current rewrite session ID.
pub fn current_rewrite_session_id() -> u64 {
    REWRITE_SESSION_COUNTER.load(Ordering::SeqCst)
}

/// Get conversation history, only if the session ID matches.
pub fn get_rewrite_conversation(session_id: u64) -> Option<Vec<RewriteMessage>> {
    REWRITE_CONVERSATION.lock().ok().and_then(|guard| {
        if guard.session_id == session_id {
            Some(guard.messages.clone())
        } else {
            None
        }
    })
}

/// Append a message to the conversation history, only if the session ID matches.
pub fn append_rewrite_message(session_id: u64, role: RewriteRole, content: String) {
    if let Ok(mut guard) = REWRITE_CONVERSATION.lock() {
        if guard.session_id == session_id {
            guard.messages.push(RewriteMessage { role, content });
        }
    }
}

/// Clear conversation history and start a new session.
fn reset_rewrite_conversation() {
    let new_id = REWRITE_SESSION_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut guard) = REWRITE_CONVERSATION.lock() {
        guard.session_id = new_id;
        guard.messages.clear();
    }
}

/// Shows the review window with multiple model candidates for selection
pub fn show_review_window_with_candidates(
    app_handle: &AppHandle,
    source_text: String,
    candidates: Vec<MultiModelCandidate>,
    history_id: Option<i64>,
    output_mode: PromptOutputMode,
    skill_name: Option<String>,
    prompt_id: Option<String>,
    auto_selected_id: Option<String>,
) {
    REVIEW_WINDOW_ACTIVE.store(false, Ordering::SeqCst);
    reset_rewrite_conversation();
    let had_visible_windows = record_hidden_windows(app_handle);
    #[cfg(target_os = "macos")]
    ensure_app_active_for_review(app_handle, had_visible_windows);

    debug!(
        "show_review_window_with_candidates called with {} candidates",
        candidates.len()
    );

    {
        let mut last_id = LAST_REVIEW_HISTORY_ID.lock().unwrap();
        *last_id = history_id;
    }

    let candidate_count = candidates.len() as f64;
    let char_count = source_text.chars().count();

    let payload = ReviewWindowMultiCandidatePayload {
        source_text,
        candidates,
        history_id,
        output_mode,
        skill_name,
        prompt_id,
        auto_selected_id,
    };

    if let Some(review_window) = app_handle.get_webview_window("review_window") {
        debug!("Found review_window, emitting multi-candidate event...");
        let (screen_w, screen_h) = get_screen_logical_size(&review_window);

        // Width: use 65% of screen width for multi-candidate, generous space for text
        let width = (screen_w * 0.65).clamp(680.0, REVIEW_WINDOW_MAX_WIDTH);

        // Height: (n+1) * per_item
        // Base 110px per slot; add 20px per 100 chars of source text for longer content
        let extra = (char_count / 100) as f64 * 20.0;
        let per_item = 110.0 + extra;
        let desired_height = (candidate_count + 1.0) * per_item;
        let height = desired_height.clamp(REVIEW_WINDOW_MIN_HEIGHT, screen_h * 0.85);

        let _ = review_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        position_window_near_cursor(&review_window, width, height);

        // Emit the multi-candidate event
        let emit_result = review_window.emit("review-window-multi-candidate", payload);
        debug!("review_window.emit() result: {:?}", emit_result);

        if emit_result.is_ok() {
            REVIEW_WINDOW_ACTIVE.store(true, Ordering::SeqCst);
        }

        let focus_token = REVIEW_WINDOW_FOCUS_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
        let show_result = review_window.show();
        debug!("review_window.show() result: {:?}", show_result);
        let focus_result = review_window.set_focus();
        debug!("review_window.set_focus() result: {:?}", focus_result);
        schedule_focus_review_window(app_handle.clone(), focus_token);
        schedule_hide_windows(app_handle.clone());
    }
}
