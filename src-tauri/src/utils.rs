use crate::managers::audio::AudioRecordingManager;
use crate::shortcut;
use crate::ManagedToggleState;
use log::{info, warn};
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

    // First, reset all shortcut toggle states.
    // This is critical for non-push-to-talk mode where shortcuts toggle on/off
    let toggle_state_manager = app.state::<ManagedToggleState>();
    if let Ok(mut states) = toggle_state_manager.lock() {
        states.active_toggles.values_mut().for_each(|v| *v = false);
    } else {
        warn!("Failed to lock toggle state manager during cancellation");
    }

    // Cancel any ongoing recording
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    audio_manager.cancel_recording();

    // Update tray icon and hide overlay
    change_tray_icon(app, crate::tray::TrayIconState::Idle);
    hide_recording_overlay(app);

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
