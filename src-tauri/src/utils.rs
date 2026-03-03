use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;
use crate::shortcut;
use crate::transcription_coordinator::TranscriptionCoordinator;
use log::info;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// Re-export all utility modules for easy access
// pub use crate::audio_feedback::*;
pub use crate::clipboard::*;
pub use crate::overlay::*;
pub use crate::tray::*;

pub fn show_or_create_main_window(
    app: &AppHandle,
    section: Option<&str>,
) -> Result<(tauri::WebviewWindow, bool), String> {
    let mut created = false;

    // On macOS, ensure the app can become active before creating/showing windows.
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = app.set_activation_policy(tauri::ActivationPolicy::Regular) {
            log::error!("Failed to set activation policy to Regular: {}", e);
        }
    }

    if app.get_webview_window("main").is_none() {
        created = true;
        create_main_window(app).map_err(|e| format!("Failed to create main window: {e}"))?;
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();

    // Some platforms (notably macOS) can fail to bring a newly-created or just-closed window
    // to front on the first call; retry shortly to avoid "needs two presses".
    let app_for_retry = app.clone();
    tauri::async_runtime::spawn(async move {
        for delay in [Duration::from_millis(120), Duration::from_millis(350)] {
            tokio::time::sleep(delay).await;
            if let Some(w) = app_for_retry.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
    });

    if let Some(section) = section {
        let app_for_emit = app.clone();
        let section = section.to_string();
        tauri::async_runtime::spawn(async move {
            if created {
                tokio::time::sleep(Duration::from_millis(350)).await;
            }

            // If the JS side isn't ready yet, retry once shortly after.
            for delay in [Duration::from_millis(0), Duration::from_millis(200)] {
                tokio::time::sleep(delay).await;
                if let Some(w) = app_for_emit.get_webview_window("main") {
                    if w.emit("navigate-to-settings", section.clone()).is_ok() {
                        break;
                    }
                }
            }
        });
    }

    Ok((window, created))
}

fn create_main_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::WebviewUrl;

    let _window =
        tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/index.html".into()))
            .title("Votype")
            .inner_size(1300.0, 1000.0)
            .min_inner_size(680.0, 570.0)
            .resizable(true)
            .maximizable(false)
            .visible(true)
            .build()?;

    Ok(())
}

/// Centralized cancellation function that can be called from anywhere in the app.
/// Handles cancelling both recording and transcription operations and updates UI state.
pub fn cancel_current_operation(app: &AppHandle) {
    use crate::ManagedPendingSkillConfirmation;

    // If there's a pending skill confirmation and the UI is visible, let the overlay handle Esc
    // The overlay will call confirm_skill with accepted=false
    if let Some(pending_state) = app.try_state::<ManagedPendingSkillConfirmation>() {
        if let Ok(guard) = pending_state.lock() {
            if guard.is_ui_visible {
                info!("Skill confirmation UI is visible - overlay will handle Esc, skipping global cancel");
                return;
            }
        }
    }

    info!("Initiating operation cancellation...");

    // Clear any pending skill confirmation state
    if let Some(pending_state) = app.try_state::<ManagedPendingSkillConfirmation>() {
        if let Ok(mut guard) = pending_state.lock() {
            *guard = crate::PendingSkillConfirmation::default();
        }
    }

    // Unregister the cancel shortcut asynchronously
    shortcut::unregister_cancel_shortcut(app);

    // Cancel any ongoing recording
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    let recording_was_active = audio_manager.is_recording();
    audio_manager.cancel_recording();

    // Update tray icon and hide overlay
    change_tray_icon(app, crate::tray::TrayIconState::Idle);
    hide_recording_overlay(app);

    // Abort the async transcription/post-processing pipeline
    let ppm = app.state::<Arc<crate::managers::post_processing::PostProcessingManager>>();
    ppm.cancel_pipeline();

    // Cancel any ongoing transcription actively
    let tm = app.state::<Arc<TranscriptionManager>>();
    let _ = tm.unload_model();

    // Notify coordinator so it can keep lifecycle state coherent.
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.notify_cancel(recording_was_active);
    }

    info!("Operation cancellation completed - returned to idle state");
}

/// Check if using the Wayland display server protocol
#[cfg(target_os = "linux")]
pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
}

/// Normalize a base URL for online ASR/LLM providers.
/// - Trims whitespace and trailing slashes.
/// - If the URL ends with '#', it's treated as a "raw" URL and the '#' is removed.
/// - If the URL doesn't have a version path (e.g., /v1), then '/v1' is automatically appended.
/// - Special protocols like `apple-intelligence://` and `ollama://` are preserved as-is.
pub fn normalize_base_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Handle explicit raw mode (ends with #)
    if trimmed.ends_with('#') {
        let raw = &trimmed[..trimmed.len() - 1];
        return raw.trim_end_matches('/').to_string();
    }

    // Skip normalization for special protocols
    if trimmed.starts_with("apple-intelligence://") || trimmed.starts_with("ollama://") {
        return trimmed.trim_end_matches('/').to_string();
    }

    // Check if it already contains a version like /v1, /v2, etc.
    let has_version = trimmed.split('/').any(|segment| {
        segment.starts_with('v')
            && segment.len() > 1
            && segment[1..].chars().all(|c| c.is_ascii_digit())
    });

    if has_version {
        trimmed.trim_end_matches('/').to_string()
    } else {
        // Append /v1 by default
        format!("{}/v1", trimmed.trim_end_matches('/'))
    }
}
