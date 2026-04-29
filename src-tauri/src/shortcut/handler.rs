//! Shared shortcut event handling logic
//!
//! This module contains the common logic for handling shortcut events,
//! used by both the Tauri and handy-keys implementations.

use log::{debug, info, warn};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

use crate::actions::ACTION_MAP;
use crate::settings::get_settings;
use crate::transcription_coordinator::is_transcribe_binding;
use crate::TranscriptionCoordinator;

/// Tracks whether the review window was focused/active at the time of key press.
/// Used so that the key release event uses the same routing decision.
static REVIEW_ROUTE_ON_PRESS: AtomicBool = AtomicBool::new(false);

/// Check if the review window should capture this transcription shortcut.
/// Returns true only when the review window is open AND Votype is the foreground app
/// (i.e., the user was interacting with the review window, not another application).
fn should_route_to_review_window(app: &AppHandle) -> bool {
    if !crate::review_window::is_review_window_active() {
        return false;
    }
    // Check if any Votype window is focused — this means the user is in Votype,
    // not in another app (browser, editor, etc.)
    for (_label, window) in app.webview_windows() {
        if window.is_focused().unwrap_or(false) {
            return true;
        }
    }
    false
}

/// Handle a shortcut event from either implementation.
///
/// This function contains the shared logic for:
/// - Looking up the action in ACTION_MAP
/// - Handling the cancel binding (only fires when recording)
/// - Handling push-to-talk mode (start on press, stop on release)
/// - Handling toggle mode (toggle state on press only)
///
/// # Arguments
/// * `app` - The Tauri app handle
/// * `binding_id` - The ID of the binding (e.g., "transcribe", "cancel")
/// * `hotkey_string` - The string representation of the hotkey
/// * `is_pressed` - Whether this is a key press (true) or release (false)
pub fn handle_shortcut_event(
    app: &AppHandle,
    binding_id: &str,
    hotkey_string: &str,
    is_pressed: bool,
) {
    // [post-insert-diag] Entry log: confirms the OS-level hotkey event actually
    // reached the handler. If this line is MISSING after a review insert, the
    // shortcut never fired — likely activation-policy thrash (H1) or a stuck
    // injected modifier (H2). If it IS present but `hotkey_string` carries an
    // unexpected modifier (e.g. "command+..."), suspect H2.
    info!(
        "[ShortcutRouter] handle_shortcut_event binding='{}' hotkey='{}' pressed={}",
        binding_id, hotkey_string, is_pressed
    );

    let settings = get_settings(app);

    // Transcribe bindings are handled by the coordinator.
    if is_transcribe_binding(binding_id) {
        // On key press: decide whether to route to review-window-local and cache the decision.
        // On key release: reuse the cached decision. This prevents the recording overlay
        // or focus loss from changing the routing mid-cycle.
        let should_route_to_review = if is_pressed {
            let route =
                hotkey_string != "review-window-local" && should_route_to_review_window(app);
            REVIEW_ROUTE_ON_PRESS.store(route, Ordering::SeqCst);
            route
        } else {
            hotkey_string != "review-window-local" && REVIEW_ROUTE_ON_PRESS.load(Ordering::SeqCst)
        };

        let effective_hotkey = if should_route_to_review {
            debug!(
                "[ShortcutRouter] Routing '{}' → review-window-local (is_pressed={})",
                binding_id, is_pressed
            );
            "review-window-local"
        } else {
            hotkey_string
        };

        if effective_hotkey == "review-window-local" && is_pressed {
            crate::review_window::freeze_review_editor_content_snapshot();
        }

        if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
            coordinator.send_input(
                binding_id,
                effective_hotkey,
                is_pressed,
                settings.activation_mode.clone(),
            );
        } else {
            warn!("TranscriptionCoordinator is not initialized");
        }
        return;
    }

    let Some(action) = ACTION_MAP.get(binding_id) else {
        warn!(
            "No action defined in ACTION_MAP for shortcut ID '{}'. Shortcut: '{}', Pressed: {}",
            binding_id, hotkey_string, is_pressed
        );
        return;
    };

    // Cancel binding: fires on key press (during recording or processing)
    if binding_id == "cancel" {
        if is_pressed {
            action.start(app, binding_id, hotkey_string);
        }
        return;
    }

    // Remaining bindings (e.g. "test") use simple start/stop on press/release.
    if is_pressed {
        action.start(app, binding_id, hotkey_string);
    } else {
        action.stop(app, binding_id, hotkey_string);
    }
}
