//! macOS consumer-key channel for remote-control record buttons.
//!
//! Some BLE voice remotes emit their record button as an NSEvent
//! `systemDefined` (CGEventType 14) Consumer event rather than a normal key
//! event. Handy-keys only taps keyboard/mouse event types (10/11/12), so
//! those presses never reach the shortcut system. Empirical probe of the
//! target remote: record button → `data1 == 0x1`, `data2 == 1` on press,
//! `data2 == 0` on release (press/release pairs are complete, so both hold
//! and toggle activation work).
//!
//! We install a `systemDefined` global monitor and feed matching events into
//! the same router entry point (`shortcut::handler::handle_shortcut_event`)
//! that handy-keys uses, as a synthetic "remote-record" hotkey on the
//! transcribe binding.

use tauri::AppHandle;

/// data1 value identifying the remote's record button (Consumer usage 0x1).
#[cfg(target_os = "macos")]
const RECORD_KEY_DATA1: isize = 0x1;

#[cfg(target_os = "macos")]
static INSTALLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn init(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let app_clone = app.clone();
        if let Err(e) = app.run_on_main_thread(move || install(app_clone)) {
            log::error!("[ConsumerKey] failed to queue main-thread install: {}", e);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "macos")]
fn install(app: AppHandle) {
    // NOTE: intentionally no `objc2::...` imports here. objc2-app-kit resolves
    // against objc2 0.6 while the crate's direct objc2 dep is 0.5; naming the
    // 0.6 types (Retained/AnyObject) would clash, so the monitor token is kept
    // via type inference only.
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
    use std::ptr::NonNull;
    use std::sync::atomic::Ordering;

    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
        let event = unsafe { event.as_ref() };
        if event.r#type() != NSEventType::SystemDefined {
            return;
        }
        let data1 = event.data1();
        let data2 = event.data2();
        if data1 != RECORD_KEY_DATA1 {
            log::debug!(
                "[ConsumerKey] ignoring systemDefined key data1={:#x} data2={:#x}",
                data1,
                data2
            );
            return;
        }
        let is_pressed = data2 != 0;
        log::info!(
            "[ConsumerKey] record key {} (data1={:#x})",
            if is_pressed { "press" } else { "release" },
            data1
        );
        crate::shortcut::handler::handle_shortcut_event(
            &app,
            "transcribe",
            "remote-record",
            is_pressed,
        );
    });

    let monitor = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
        NSEventMask::SystemDefined,
        &handler,
    );

    if monitor.is_some() {
        // AppKit expects the returned token (and the block) to stay alive for
        // the process lifetime; intentionally leak both.
        std::mem::forget(monitor);
        std::mem::forget(handler);
        log::info!(
            "[ConsumerKey] systemDefined monitor installed (record key data1={:#x})",
            RECORD_KEY_DATA1
        );
    } else {
        INSTALLED.store(false, Ordering::SeqCst);
        log::error!("[ConsumerKey] failed to install systemDefined monitor");
    }
}
