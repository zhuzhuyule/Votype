use crate::input;
use crate::managers::audio::AudioRecordingManager;
use crate::settings;
use crate::settings::OverlayPosition;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(not(target_os = "macos"))]
use log::debug;

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecordingOverlayPanel {
        config: {
            // Allow becoming key window so we can receive keyboard input for skill confirmation
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

// This is the *window* size; the overlay UI inside can be smaller and is centered.
// We keep this large enough to support realtime transcription with internal scrolling.
const OVERLAY_WIDTH: f64 = 540.0;
const OVERLAY_HEIGHT: f64 = 160.0;
const CURSOR_VERTICAL_OFFSET: f64 = 18.0;

#[cfg(target_os = "macos")]
const OVERLAY_TOP_OFFSET: f64 = 46.0;
#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_TOP_OFFSET: f64 = 4.0;

#[cfg(target_os = "macos")]
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_BOTTOM_OFFSET: f64 = 40.0;

/// Forces a window to be topmost using Win32 API (Windows only)
/// This is more reliable than Tauri's set_always_on_top which can be overridden
#[cfg(target_os = "windows")]
fn force_overlay_topmost(overlay_window: &tauri::webview::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    // Clone because run_on_main_thread takes 'static
    let overlay_clone = overlay_window.clone();

    // Make sure the Win32 call happens on the UI thread
    let _ = overlay_clone.clone().run_on_main_thread(move || {
        if let Ok(hwnd) = overlay_clone.hwnd() {
            unsafe {
                // Force Z-order: make this window topmost without changing size/pos or stealing focus
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    });
}

fn get_monitor_with_cursor(app_handle: &AppHandle) -> Option<(tauri::Monitor, (f64, f64))> {
    let cursor = input::get_cursor_position(app_handle)?;
    let cursor_x = cursor.0 as f64;
    let cursor_y = cursor.1 as f64;

    if let Ok(monitors) = app_handle.available_monitors() {
        for monitor in monitors {
            let scale = monitor.scale_factor();
            let min_x = monitor.position().x as f64 / scale;
            let min_y = monitor.position().y as f64 / scale;
            let max_x = min_x + monitor.size().width as f64 / scale;
            let max_y = min_y + monitor.size().height as f64 / scale;

            if cursor_x >= min_x && cursor_x < max_x && cursor_y >= min_y && cursor_y < max_y {
                return Some((monitor, (cursor_x, cursor_y)));
            }
        }
    }

    None
}

fn calculate_overlay_position(app_handle: &AppHandle) -> Option<(f64, f64)> {
    let settings = settings::get_settings(app_handle);

    if settings.overlay_position == OverlayPosition::FollowCursor {
        if let Some((monitor, cursor_pos)) = get_monitor_with_cursor(app_handle) {
            let scale = monitor.scale_factor();
            let work_area = monitor.work_area();
            let work_area_x = work_area.position.x as f64 / scale;
            let work_area_y = work_area.position.y as f64 / scale;
            let work_area_width = work_area.size.width as f64 / scale;
            let work_area_height = work_area.size.height as f64 / scale;

            let mut x = cursor_pos.0 - OVERLAY_WIDTH / 2.0;
            let mut y = cursor_pos.1 + CURSOR_VERTICAL_OFFSET;
            if y + OVERLAY_HEIGHT > work_area_y + work_area_height {
                y = cursor_pos.1 - OVERLAY_HEIGHT - CURSOR_VERTICAL_OFFSET;
            }

            x = x.clamp(work_area_x, work_area_x + work_area_width - OVERLAY_WIDTH);
            y = y.clamp(work_area_y, work_area_y + work_area_height - OVERLAY_HEIGHT);

            return Some((x, y));
        }
    } else if settings.overlay_position != OverlayPosition::None {
        if let Some((monitor, _)) = get_monitor_with_cursor(app_handle) {
            return Some(position_on_monitor(&monitor, settings.overlay_position));
        }
    }

    if let Ok(Some(monitor)) = app_handle.primary_monitor() {
        if settings.overlay_position == OverlayPosition::None {
            return None;
        }
        return Some(position_on_monitor(&monitor, settings.overlay_position));
    }

    None
}

fn position_on_monitor(monitor: &tauri::Monitor, overlay_position: OverlayPosition) -> (f64, f64) {
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let work_area_width = work_area.size.width as f64 / scale;
    let work_area_height = work_area.size.height as f64 / scale;
    let work_area_x = work_area.position.x as f64 / scale;
    let work_area_y = work_area.position.y as f64 / scale;

    let x = work_area_x + (work_area_width - OVERLAY_WIDTH) / 2.0;
    let y = match overlay_position {
        OverlayPosition::Top => work_area_y + OVERLAY_TOP_OFFSET,
        OverlayPosition::Bottom => {
            work_area_y + work_area_height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_OFFSET
        }
        OverlayPosition::FollowCursor => {
            work_area_y + work_area_height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_OFFSET
        }
        OverlayPosition::None => {
            work_area_y + work_area_height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_OFFSET
        }
    };

    (x, y)
}

/// Creates the recording overlay window and keeps it hidden by default
#[cfg(not(target_os = "macos"))]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    if let Some((x, y)) = calculate_overlay_position(app_handle) {
        match WebviewWindowBuilder::new(
            app_handle,
            "recording_overlay",
            tauri::WebviewUrl::App("src/overlay/index.html".into()),
        )
        .title("Recording")
        .position(x, y)
        .resizable(false)
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .shadow(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .accept_first_mouse(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .focused(false)
        .visible(false)
        .build()
        {
            Ok(_window) => {
                debug!("Recording overlay window created successfully (hidden)");
            }
            Err(e) => {
                debug!("Failed to create recording overlay window: {}", e);
            }
        }
    }
}

/// Creates the recording overlay panel and keeps it hidden by default (macOS)
#[cfg(target_os = "macos")]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    if let Some((x, y)) = calculate_overlay_position(app_handle) {
        // PanelBuilder creates a Tauri window then converts it to NSPanel.
        // The window remains registered, so get_webview_window() still works.
        match PanelBuilder::<_, RecordingOverlayPanel>::new(app_handle, "recording_overlay")
            .url(WebviewUrl::App("src/overlay/index.html".into()))
            .title("Recording")
            .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .level(PanelLevel::Status)
            .size(tauri::Size::Logical(tauri::LogicalSize {
                width: OVERLAY_WIDTH,
                height: OVERLAY_HEIGHT,
            }))
            .has_shadow(false)
            .transparent(true)
            .no_activate(true)
            .corner_radius(0.0)
            .with_window(|w| w.decorations(false).transparent(true))
            .collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary(),
            )
            .build()
        {
            Ok(panel) => {
                let _ = panel.hide();
            }
            Err(e) => {
                log::error!("Failed to create recording overlay panel: {}", e);
            }
        }
    }
}

/// Shows the recording overlay window with fade-in animation
pub fn show_recording_overlay(app_handle: &AppHandle) {
    // Check if overlay should be shown based on position setting
    let settings = settings::get_settings(app_handle);
    if settings.overlay_position == OverlayPosition::None {
        return;
    }

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Update position before showing to prevent flicker from position changes
        if let Some((x, y)) = calculate_overlay_position(app_handle) {
            let _ = overlay_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }

        let _ = overlay_window.show();

        // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
        #[cfg(target_os = "windows")]
        force_overlay_topmost(&overlay_window);

        emit_overlay_state_with_retry(overlay_window, "recording");
    }
}

/// Shows the transcribing overlay window
pub fn show_transcribing_overlay(app_handle: &AppHandle) {
    // Check if overlay should be shown based on position setting
    let settings = settings::get_settings(app_handle);
    if settings.overlay_position == OverlayPosition::None {
        return;
    }

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Only update position if the overlay is not currently visible
        if !overlay_window.is_visible().unwrap_or(false) {
            update_overlay_position(app_handle);
        }

        let _ = overlay_window.show();

        // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
        #[cfg(target_os = "windows")]
        force_overlay_topmost(&overlay_window);

        emit_overlay_state_with_retry(overlay_window, "transcribing");
    }
}

/// Shows the LLM processing overlay window
pub fn show_llm_processing_overlay(app_handle: &AppHandle) {
    let settings = settings::get_settings(app_handle);
    if settings.overlay_position == OverlayPosition::None {
        return;
    }

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Only update position if the overlay is not currently visible
        if !overlay_window.is_visible().unwrap_or(false) {
            update_overlay_position(app_handle);
        }

        let _ = overlay_window.show();
        emit_overlay_state_with_retry(overlay_window, "llm");
    }
}

fn emit_overlay_state_with_retry(overlay_window: tauri::WebviewWindow, state: &'static str) {
    let _ = overlay_window.emit("show-overlay", state);

    std::thread::spawn(move || {
        for delay_ms in [40_u64, 120_u64] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            let _ = overlay_window.emit("show-overlay", state);
        }
    });
}

/// Updates the overlay window position based on current settings
pub fn update_overlay_position(app_handle: &AppHandle) {
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        if let Some((x, y)) = calculate_overlay_position(app_handle) {
            let _ = overlay_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }
    }
}

/// Hides the recording overlay window with fade-out animation
pub fn hide_recording_overlay(app_handle: &AppHandle) {
    // Always hide the overlay regardless of settings - if setting was changed while recording,
    // we still want to hide it properly
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Emit event to trigger fade-out animation
        let _ = overlay_window.emit("hide-overlay", ());
        // Hide the window after a short delay to allow animation to complete
        let window_clone = overlay_window.clone();
        let app_handle_clone = app_handle.clone();

        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));

            // Check if we started recording again during the fade-out
            let rm = app_handle_clone.state::<Arc<AudioRecordingManager>>();
            if rm.is_recording() {
                return;
            }

            let _ = window_clone.hide();
        });
    }
}

pub fn emit_levels(app_handle: &AppHandle, levels: &Vec<f32>) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static EMIT_COUNT: AtomicU64 = AtomicU64::new(0);
    let count = EMIT_COUNT.fetch_add(1, Ordering::Relaxed);
    // Log every ~2 seconds (assuming ~30 emits/sec)
    if count % 60 == 0 {
        let max = levels.iter().cloned().fold(0.0f32, f32::max);
        let has_overlay = app_handle.get_webview_window("recording_overlay").is_some();
        log::debug!(
            "[waveform-emit] #{} max_level={:.3} has_overlay={}",
            count,
            max,
            has_overlay,
        );
    }

    // emit levels to main app
    let _ = app_handle.emit("mic-level", levels);

    // also emit to the recording overlay if it's open
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.emit("mic-level", levels);
    }
}

/// Makes the overlay window key window so it can receive keyboard input
/// Used when showing skill confirmation dialog
/// On macOS, we need to activate the app first, then make the panel key window
#[cfg(target_os = "macos")]
pub fn focus_recording_overlay(app_handle: &AppHandle) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send, msg_send_id};
    use tauri_nspanel::ManagerExt;

    let app_handle_inner = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        // First, activate the current app to force macOS to give us focus
        unsafe {
            // Get current process ID
            let pid = std::process::id() as i32;

            // Get NSRunningApplication class
            let cls = class!(NSRunningApplication);

            // Call +[NSRunningApplication runningApplicationWithProcessIdentifier:]
            let app: Option<Retained<AnyObject>> =
                msg_send_id![cls, runningApplicationWithProcessIdentifier: pid];

            if let Some(app) = app {
                // NSApplicationActivateIgnoringOtherApps = 1 << 1 = 2
                let options: usize = 2;
                let _: bool = msg_send![&*app, activateWithOptions: options];
            }
        }

        // Small delay to ensure activation completes (using sleep on main thread is slightly risky
        // but 20ms is short enough for this specific UX requirement)
        std::thread::sleep(std::time::Duration::from_millis(20));

        // Now make the panel key window
        if let Ok(panel) = app_handle_inner.get_webview_panel("recording_overlay") {
            panel.make_key_window();
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn focus_recording_overlay(app_handle: &AppHandle) {
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.set_focus();
    }
}
