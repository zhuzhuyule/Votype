use log::{debug, warn};
use std::thread;
use tauri::{AppHandle, Manager};

#[cfg(unix)]
use signal_hook::consts::SIGUSR2;
#[cfg(unix)]
use signal_hook::iterator::Signals;

#[cfg(unix)]
pub fn setup_signal_handler(app_handle: AppHandle, mut signals: Signals) {
    let app_handle_for_signal = app_handle.clone();

    debug!("SIGUSR2 signal handler registered successfully");
    thread::spawn(move || {
        debug!("SIGUSR2 signal handler thread started");
        for sig in signals.forever() {
            match sig {
                SIGUSR2 => {
                    debug!("Received SIGUSR2 signal (signal number: {sig})");

                    let binding_id = "transcribe";
                    debug!("SIGUSR2: Received signal, dispatching to TranscriptionCoordinator");
                    if let Some(coordinator) = app_handle_for_signal
                        .try_state::<crate::transcription_coordinator::TranscriptionCoordinator>()
                    {
                        coordinator.send_input(binding_id, "SIGUSR2", true, false);
                    } else {
                        warn!("TranscriptionCoordinator missing from state");
                    }
                }
                _ => unreachable!(),
            }
        }
    });
}
