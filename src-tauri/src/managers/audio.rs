use crate::audio_toolkit::{
    list_input_devices,
    vad::{
        frames_for_duration_ms, EarshotVad, SmoothedVad, VAD_OFFLINE_HANGOVER_MS, VAD_ONSET_MS,
        VAD_PREFILL_MS, VAD_STREAMING_HANGOVER_MS,
    },
    AudioRecorder, SileroVad, VadPolicy, VoiceActivityDetector,
};
use crate::helpers::clamshell;
use crate::settings::{get_settings, write_settings, AppSettings, VadBackend};
use crate::utils;
use log::{debug, error, info, trace, warn};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const SILERO_VAD_THRESHOLD: f32 = 0.3;
const EARSHOT_VAD_THRESHOLD: f32 = 0.5;

fn set_mute(mute: bool) {
    // Expected behavior:
    // - Windows: works on most systems using standard audio drivers.
    // - Linux: works on many systems (PipeWire, PulseAudio, ALSA),
    //   but some distros may lack the tools used.
    // - macOS: works on most standard setups via AppleScript.
    // If unsupported, fails silently.

    #[cfg(target_os = "windows")]
    {
        unsafe {
            use windows::Win32::{
                Media::Audio::{
                    eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
                    MMDeviceEnumerator,
                },
                System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
            };

            macro_rules! unwrap_or_return {
                ($expr:expr) => {
                    match $expr {
                        Ok(val) => val,
                        Err(_) => return,
                    }
                };
            }

            // Initialize the COM library for this thread.
            // If already initialized (e.g., by another library like Tauri), this does nothing.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let all_devices: IMMDeviceEnumerator =
                unwrap_or_return!(CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL));
            let default_device =
                unwrap_or_return!(all_devices.GetDefaultAudioEndpoint(eRender, eMultimedia));
            let volume_interface = unwrap_or_return!(
                default_device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            );

            let _ = volume_interface.SetMute(mute, std::ptr::null());
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let mute_val = if mute { "1" } else { "0" };
        let amixer_state = if mute { "mute" } else { "unmute" };

        // Try multiple backends to increase compatibility
        // 1. PipeWire (wpctl)
        if Command::new("wpctl")
            .args(["set-mute", "@DEFAULT_AUDIO_SINK@", mute_val])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return;
        }

        // 2. PulseAudio (pactl)
        if Command::new("pactl")
            .args(["set-sink-mute", "@DEFAULT_SINK@", mute_val])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return;
        }

        // 3. ALSA (amixer)
        let _ = Command::new("amixer")
            .args(["set", "Master", amixer_state])
            .output();
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let script = format!(
            "set volume output muted {}",
            if mute { "true" } else { "false" }
        );
        let _ = Command::new("osascript").args(["-e", &script]).output();
    }
}

const WHISPER_SAMPLE_RATE: usize = 16000;
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/* ──────────────────────────────────────────────────────────────── */

#[derive(Clone, Debug)]
pub enum RecordingState {
    Idle,
    Recording {
        binding_id: String,
    },
    /// Stop is in flight (trailing-buffer sleep + recorder drain). Blocks a
    /// new start from racing the pending `recorder.stop()` (upstream #1910
    /// precondition / cjpais Handy Stopping state).
    Stopping,
}

#[derive(Clone, Debug)]
pub enum MicrophoneMode {
    AlwaysOn,
    OnDemand,
}

/* ──────────────────────────────────────────────────────────────── */

/// The persisted microphone preference currently in effect. Clamshell and
/// regular selections are kept distinct so losing a clamshell-only device does
/// not erase the user's normal microphone preference.
enum DesiredMicrophone {
    Default,
    Selected(String),
    Clamshell(String),
}

/// Result of resolving the persisted preference to a live cpal device.
/// `device: None` means cpal should open the system default. The unavailable
/// name is populated only when enumeration succeeded and confirmed that the
/// user's regular selected microphone is missing.
struct MicrophoneResolution {
    device: Option<cpal::Device>,
    unavailable_selected_microphone: Option<String>,
}

/* ──────────────────────────────────────────────────────────────── */

fn create_audio_recorder(
    backend: VadBackend,
    app_handle: &tauri::AppHandle,
    speech_frame_tx: Arc<Mutex<Option<mpsc::Sender<Vec<f32>>>>>,
    stream_router: &Arc<crate::managers::transcription::StreamRouter>,
    auto_enhance_enabled: Arc<AtomicBool>,
) -> Result<AudioRecorder, anyhow::Error> {
    let detector: Box<dyn VoiceActivityDetector> = match backend {
        VadBackend::Silero => {
            let vad_path = app_handle
                .path()
                .resolve(
                    "resources/models/silero_vad_v4.onnx",
                    tauri::path::BaseDirectory::Resource,
                )
                .map_err(|e| anyhow::anyhow!("Failed to resolve VAD path: {e}"))?;
            Box::new(
                SileroVad::new(vad_path, SILERO_VAD_THRESHOLD)
                    .map_err(|e| anyhow::anyhow!("Failed to create SileroVad: {e}"))?,
            )
        }
        VadBackend::Earshot => Box::new(
            EarshotVad::new(EARSHOT_VAD_THRESHOLD)
                .map_err(|e| anyhow::anyhow!("Failed to create EarshotVad: {e}"))?,
        ),
    };

    // Earshot uses 16 ms frames while Silero uses 30 ms. Convert the existing
    // time-based capture profile to each detector's frame size so selecting a
    // backend does not shorten pre-roll, onset, or post-speech audio.
    let frame_samples = detector.frame_samples();
    let prefill_frames = frames_for_duration_ms(VAD_PREFILL_MS, frame_samples);
    let offline_hangover_frames = frames_for_duration_ms(VAD_OFFLINE_HANGOVER_MS, frame_samples);
    let streaming_hangover_frames =
        frames_for_duration_ms(VAD_STREAMING_HANGOVER_MS, frame_samples);
    let onset_frames = frames_for_duration_ms(VAD_ONSET_MS, frame_samples);
    let smoothed_vad = SmoothedVad::new(
        detector,
        prefill_frames,
        offline_hangover_frames,
        onset_frames,
    );

    info!(
        "Initialized {:?} VAD backend ({} samples/frame)",
        backend, frame_samples
    );

    // Recorder with VAD plus a spectrum-level callback that forwards updates to
    // the frontend, and an audio-frame callback that feeds live streaming via
    // the shared `StreamRouter` (captured directly, not via Tauri state — see
    // its docs) while still forwarding to the realtime-simulation sender.
    let recorder = AudioRecorder::new()
        .map_err(|e| anyhow::anyhow!("Failed to create AudioRecorder: {}", e))?
        .with_vad(
            Box::new(smoothed_vad),
            offline_hangover_frames,
            streaming_hangover_frames,
        )
        .with_level_callback({
            let app_handle = app_handle.clone();
            move |levels| {
                utils::emit_levels(&app_handle, &levels);
            }
        })
        .with_audio_callback({
            let router = Arc::clone(stream_router);
            move |speech_frame| {
                router.feed(speech_frame);
                if let Some(tx) = speech_frame_tx.lock().unwrap().as_ref() {
                    let _ = tx.send(speech_frame.to_vec());
                }
            }
        })
        .with_auto_enhance_flag(auto_enhance_enabled);

    Ok(recorder)
}

/* ──────────────────────────────────────────────────────────────── */

#[derive(Clone)]
pub struct AudioRecordingManager {
    state: Arc<Mutex<RecordingState>>,
    mode: Arc<Mutex<MicrophoneMode>>,
    app_handle: tauri::AppHandle,

    recorder: Arc<Mutex<Option<AudioRecorder>>>,
    is_open: Arc<Mutex<bool>>,
    /// Lock-free mirror of "a recording owns the recorder" (Recording or
    /// Stopping). Readers (Tauri commands, lazy-close thread) must never take
    /// the state Mutex because it is held across blocking CoreAudio calls
    /// (device probing, trailing-buffer sleeps).
    recording_active: Arc<AtomicBool>,
    did_mute: Arc<Mutex<bool>>,
    current_transcription_id: Arc<AtomicU64>,
    speech_frame_tx: Arc<Mutex<Option<mpsc::Sender<Vec<f32>>>>>,
    /// Live-streaming feed shared with the TranscriptionManager (owned by the
    /// recorder itself so per-frame routing skips Tauri state entirely).
    stream_router: Arc<crate::managers::transcription::StreamRouter>,
    online_transcription_rx: Arc<Mutex<Option<mpsc::Receiver<anyhow::Result<String>>>>>,
    auto_enhance_enabled: Arc<AtomicBool>,
    close_generation: Arc<AtomicU64>,
}

impl AudioRecordingManager {
    /* ---------- construction ------------------------------------------------ */

    pub fn new(
        app: &tauri::AppHandle,
        stream_router: Arc<crate::managers::transcription::StreamRouter>,
    ) -> Result<Self, anyhow::Error> {
        let settings = get_settings(app);
        let mode = if settings.always_on_microphone {
            MicrophoneMode::AlwaysOn
        } else {
            MicrophoneMode::OnDemand
        };

        let manager = Self {
            state: Arc::new(Mutex::new(RecordingState::Idle)),
            mode: Arc::new(Mutex::new(mode.clone())),
            app_handle: app.clone(),

            recorder: Arc::new(Mutex::new(None)),
            is_open: Arc::new(Mutex::new(false)),
            recording_active: Arc::new(AtomicBool::new(false)),
            did_mute: Arc::new(Mutex::new(false)),
            current_transcription_id: Arc::new(AtomicU64::new(0)),
            speech_frame_tx: Arc::new(Mutex::new(None)),
            stream_router,
            online_transcription_rx: Arc::new(Mutex::new(None)),
            auto_enhance_enabled: Arc::new(AtomicBool::new(settings.audio_input_auto_enhance)),
            close_generation: Arc::new(AtomicU64::new(0)),
        };

        // Always-on?  Open immediately.
        if matches!(mode, MicrophoneMode::AlwaysOn) {
            manager.start_microphone_stream()?;
        }

        Ok(manager)
    }

    pub fn set_speech_frame_sender(&self, tx: Option<mpsc::Sender<Vec<f32>>>) {
        *self.speech_frame_tx.lock().unwrap() = tx;
    }

    pub fn set_online_transcription_receiver(
        &self,
        rx: Option<mpsc::Receiver<anyhow::Result<String>>>,
    ) {
        *self.online_transcription_rx.lock().unwrap() = rx;
    }

    #[allow(dead_code)]
    pub fn take_online_transcription_receiver(
        &self,
    ) -> Option<mpsc::Receiver<anyhow::Result<String>>> {
        self.online_transcription_rx.lock().unwrap().take()
    }

    pub fn set_auto_enhance_enabled(&self, enabled: bool) {
        self.auto_enhance_enabled.store(enabled, Ordering::Relaxed);
        log::info!("Audio auto-enhance set to: {}", enabled);
    }

    /// Single write entry point for `state`; keeps `recording_active`
    /// derived so the two can never drift.
    fn set_state(&self, guard: &mut RecordingState, new_state: RecordingState) {
        *guard = new_state;
        self.recording_active.store(
            matches!(
                *guard,
                RecordingState::Recording { .. } | RecordingState::Stopping
            ),
            Ordering::SeqCst,
        );
    }

    /* ---------- helper methods --------------------------------------------- */

    fn desired_microphone(&self, settings: &AppSettings) -> DesiredMicrophone {
        // Check if we're in clamshell mode and have a clamshell microphone configured
        if let Some(clamshell_microphone) = &settings.clamshell_microphone {
            let is_clamshell = clamshell::is_clamshell().unwrap_or(false);
            if is_clamshell {
                return DesiredMicrophone::Clamshell(clamshell_microphone.clone());
            }
        }
        match &settings.selected_microphone {
            Some(name) => DesiredMicrophone::Selected(name.clone()),
            None => DesiredMicrophone::Default,
        }
    }

    fn resolve_microphone_device(&self, settings: &AppSettings) -> MicrophoneResolution {
        let desired = self.desired_microphone(settings);
        let (device_name, selected_microphone) = match desired {
            DesiredMicrophone::Default => {
                debug!("device resolve: no mic configured -> system default");
                return MicrophoneResolution {
                    device: None,
                    unavailable_selected_microphone: None,
                };
            }
            DesiredMicrophone::Selected(name) => (name.clone(), Some(name)),
            DesiredMicrophone::Clamshell(name) => (name, None),
        };

        // Only report a selected microphone as unavailable when enumeration
        // itself succeeded. A backend enumeration error may be transient and
        // must not erase the user's persisted preference.
        let (device, enumeration_succeeded) = match list_input_devices() {
            Ok(devices) => (
                devices
                    .into_iter()
                    .find(|d| d.name == device_name)
                    .map(|d| d.device),
                true,
            ),
            Err(e) => {
                debug!("Failed to list devices, using default: {}", e);
                (None, false)
            }
        };

        let unavailable_selected_microphone = if enumeration_succeeded && device.is_none() {
            selected_microphone
        } else {
            None
        };
        MicrophoneResolution {
            device,
            unavailable_selected_microphone,
        }
    }

    /// Keep persisted settings and the UI aligned with a successful runtime
    /// fallback. Re-read first so recovery cannot clear a microphone the user
    /// selected concurrently while the stream was being rebuilt.
    fn persist_default_microphone_after_fallback(&self, unavailable_name: &str) {
        let mut settings = get_settings(&self.app_handle);
        if settings.selected_microphone.as_deref() != Some(unavailable_name) {
            return;
        }

        settings.selected_microphone = None;
        write_settings(&self.app_handle, settings);
        let _ = self.app_handle.emit(
            "settings-changed",
            serde_json::json!({
                "setting": "selected_microphone",
                "value": "Default"
            }),
        );
    }

    /* ---------- microphone life-cycle -------------------------------------- */

    /// Applies mute if mute_while_recording is enabled and stream is open
    pub fn apply_mute(&self) {
        let settings = get_settings(&self.app_handle);
        let mut did_mute_guard = self.did_mute.lock().unwrap();

        if settings.mute_while_recording && *self.is_open.lock().unwrap() {
            set_mute(true);
            *did_mute_guard = true;
            debug!("Mute applied");
        }
    }

    /// Removes mute if it was applied
    pub fn remove_mute(&self) {
        let mut did_mute_guard = self.did_mute.lock().unwrap();
        if *did_mute_guard {
            set_mute(false);
            *did_mute_guard = false;
            debug!("Mute removed");
        }
    }

    /// Pre-load the VAD model and create the recorder if not already done.
    /// This can be called in parallel with ASR model loading to reduce
    /// first-recording latency.
    pub fn preload_vad(&self) -> Result<(), anyhow::Error> {
        let mut recorder_opt = self.recorder.lock().unwrap();
        if recorder_opt.is_some() {
            return Ok(()); // Already created
        }

        let settings = get_settings(&self.app_handle);
        *recorder_opt = Some(create_audio_recorder(
            settings.vad_backend,
            &self.app_handle,
            self.speech_frame_tx.clone(),
            &self.stream_router,
            self.auto_enhance_enabled.clone(),
        )?);

        Ok(())
    }

    pub fn start_microphone_stream(&self) -> Result<(), anyhow::Error> {
        let mut open_flag = self.is_open.lock().unwrap();
        if *open_flag {
            // `is_open` only records that we opened a stream at some point, not
            // that one is still running. If capture has since failed (mic
            // unplugged mid-session, USB dropout, pause-ack timeout), rebuild
            // before the next recording instead of handing the caller a dead
            // recorder that captures nothing (upstream #1838 / #1954).
            let needs_reopen = self
                .recorder
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|rec| rec.needs_reopen());

            if !needs_reopen {
                // trace, not debug: with the aliveness check in
                // try_start_recording this now fires on every keypress in
                // always-on mode.
                trace!("Microphone stream already active");
                return Ok(());
            }

            warn!("Microphone stream is no longer running (device disconnected?); reopening");

            // Torn down inline rather than via stop_microphone_stream(), which
            // takes the `is_open` lock we are already holding.
            {
                let mut did_mute_guard = self.did_mute.lock().unwrap();
                if *did_mute_guard {
                    set_mute(false);
                    *did_mute_guard = false;
                }
            }
            if let Some(rec) = self.recorder.lock().unwrap().as_mut() {
                let _ = rec.close();
            }
            // The state mutex may be held by try_start_recording (which locks
            // state -> is_open); use try_lock so this recovery path can never
            // dead-lock against it. A missed reset self-heals on the next stop.
            if let Ok(mut state) = self.state.try_lock() {
                if matches!(*state, RecordingState::Recording { .. }) {
                    self.set_state(&mut state, RecordingState::Idle);
                }
            }
            *open_flag = false;
            // Fall through and open a fresh stream.
        }

        let start_time = Instant::now();

        // Don't mute immediately - caller will handle muting after audio feedback.
        // The previous stream restored audio on close, so did_mute should already
        // be false here; if it somehow isn't, restore rather than just clearing
        // the flag, which would strand system audio muted.
        {
            let mut did_mute_guard = self.did_mute.lock().unwrap();
            if *did_mute_guard {
                set_mute(false);
                *did_mute_guard = false;
            }
        }

        // Ensure VAD/recorder is created (may already be done via preload_vad)
        self.preload_vad()?;
        let mut recorder_opt = self.recorder.lock().unwrap();

        // Get the selected device from settings, considering clamshell mode
        let settings = get_settings(&self.app_handle);
        let mut resolution = self.resolve_microphone_device(&settings);

        if let Some(rec) = recorder_opt.as_mut() {
            if let Err(first_err) = rec.open(resolution.device.as_ref().cloned()) {
                // A cached config may have gone stale (unplugged, rate/format
                // changed). Re-resolve from a fresh enumeration and retry once
                // before surfacing the error.
                warn!("Recorder open failed ({first_err}); re-resolving device and retrying once");
                resolution = self.resolve_microphone_device(&settings);
                let msg = match rec.open(resolution.device.as_ref().cloned()) {
                    Ok(()) => String::new(),
                    Err(e) => format!("{e}"),
                };
                if !msg.is_empty() {
                    if crate::audio_toolkit::is_no_input_device_error(&msg) {
                        let _ = self.app_handle.emit(
                            "recording-error",
                            serde_json::json!({
                                "error_type": "no_input_device",
                                "detail": msg,
                            }),
                        );
                    }
                    return Err(anyhow::anyhow!("Failed to open recorder: {}", msg));
                }
            }
        }

        *open_flag = true;
        if let Some(unavailable_name) = resolution.unavailable_selected_microphone {
            // Do this only after the default stream opened successfully. A
            // failed fallback must not erase the user's microphone preference.
            self.persist_default_microphone_after_fallback(&unavailable_name);
        }
        info!(
            "Microphone stream initialized in {:?}",
            start_time.elapsed()
        );
        Ok(())
    }

    fn schedule_lazy_close(&self) {
        let gen = self.close_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let close_gen = self.close_generation.clone();
        let is_open = self.is_open.clone();
        let recorder = self.recorder.clone();
        let recording_active = self.recording_active.clone();
        let did_mute = self.did_mute.clone();

        std::thread::spawn(move || {
            std::thread::sleep(STREAM_IDLE_TIMEOUT);
            // Only close if generation hasn't changed (no new recording started)
            if close_gen.load(Ordering::SeqCst) != gen {
                return;
            }
            let mut open_flag = is_open.lock().unwrap();
            if !*open_flag {
                return;
            }
            if recording_active.load(Ordering::SeqCst) {
                return; // Recording started while we were sleeping
            }

            // Unmute system audio if it was muted during recording
            let mut did_mute_guard = did_mute.lock().unwrap();
            if *did_mute_guard {
                set_mute(false);
                *did_mute_guard = false;
            }

            if let Some(rec) = recorder.lock().unwrap().as_mut() {
                let _ = rec.close();
            }
            *open_flag = false;
            info!(
                "Closed idle microphone stream after {:?}",
                STREAM_IDLE_TIMEOUT
            );
        });
    }

    pub fn stop_microphone_stream(&self) {
        let mut open_flag = self.is_open.lock().unwrap();
        if !*open_flag {
            return;
        }

        let mut did_mute_guard = self.did_mute.lock().unwrap();
        if *did_mute_guard {
            set_mute(false);
        }
        *did_mute_guard = false;

        // Lock order: recorder guard must be released before taking `state`
        // (try_start_recording holds state while it touches the recorder).
        let stopped_mid_recording = if let Some(rec) = self.recorder.lock().unwrap().as_mut() {
            // If still recording, stop first.
            if self.recording_active.load(Ordering::SeqCst) {
                let _ = rec.stop();
                true
            } else {
                false
            }
        } else {
            false
        };
        if stopped_mid_recording {
            let mut state = self.state.lock().unwrap();
            self.set_state(&mut state, RecordingState::Idle);
            drop(state);
            self.set_speech_frame_sender(None);
        }

        if let Some(rec) = self.recorder.lock().unwrap().as_mut() {
            let _ = rec.close();
        }

        *open_flag = false;
        debug!("Microphone stream stopped");
    }

    /* ---------- mode switching --------------------------------------------- */

    pub fn update_mode(&self, new_mode: MicrophoneMode) -> Result<(), anyhow::Error> {
        let mode_guard = self.mode.lock().unwrap();
        let cur_mode = mode_guard.clone();

        match (cur_mode, &new_mode) {
            (MicrophoneMode::AlwaysOn, MicrophoneMode::OnDemand) => {
                if matches!(*self.state.lock().unwrap(), RecordingState::Idle) {
                    drop(mode_guard);
                    self.close_generation.fetch_add(1, Ordering::SeqCst);
                    self.stop_microphone_stream();
                }
            }
            (MicrophoneMode::OnDemand, MicrophoneMode::AlwaysOn) => {
                drop(mode_guard);
                self.start_microphone_stream()?;
            }
            _ => {}
        }

        *self.mode.lock().unwrap() = new_mode;
        Ok(())
    }

    /* ---------- recording --------------------------------------------------- */

    pub fn try_start_recording(
        &self,
        binding_id: &str,
        skip_frames: usize,
        vad_policy: VadPolicy,
    ) -> bool {
        let mut state = self.state.lock().unwrap();

        if let RecordingState::Idle = *state {
            // Cancel any pending lazy close
            self.close_generation.fetch_add(1, Ordering::SeqCst);

            // Opens the stream in on-demand mode. In always-on mode the stream
            // is normally already open and this is a cheap aliveness check —
            // but if the capture worker died (device disconnect), it rebuilds
            // the stream instead of leaving every subsequent start wedged on
            // a dead recorder (upstream #1838).
            if let Err(e) = self.start_microphone_stream() {
                error!("Failed to open microphone stream: {e}");
                return false;
            }

            if let Some(rec) = self.recorder.lock().unwrap().as_ref() {
                if rec.start(vad_policy, skip_frames).is_ok() {
                    self.set_state(
                        &mut state,
                        RecordingState::Recording {
                            binding_id: binding_id.to_string(),
                        },
                    );
                    debug!("Recording started for binding {binding_id}");
                    return true;
                }
            }
            error!("Recorder not available");
            false
        } else {
            false
        }
    }

    pub fn update_selected_device(&self) -> Result<(), anyhow::Error> {
        // Cancel any pending lazy close before restarting
        self.close_generation.fetch_add(1, Ordering::SeqCst);
        // If currently open, restart the microphone stream to use the new device
        if *self.is_open.lock().unwrap() {
            self.stop_microphone_stream();
            self.start_microphone_stream()?;
        }
        Ok(())
    }

    /// Replace the VAD implementation while idle. If the microphone stream is
    /// currently warm (always-on or lazy-close mode), reopen it with the new
    /// detector before reporting success. A failed reopen restores the previous
    /// recorder so the persisted setting can remain unchanged.
    pub fn update_vad_backend(&self, backend: VadBackend) -> Result<(), anyhow::Error> {
        let state = self.state.lock().unwrap();
        if !matches!(*state, RecordingState::Idle) {
            return Err(anyhow::anyhow!(
                "Cannot change the VAD backend while recording"
            ));
        }

        let replacement = create_audio_recorder(
            backend,
            &self.app_handle,
            self.speech_frame_tx.clone(),
            &self.stream_router,
            self.auto_enhance_enabled.clone(),
        )?;
        let was_open = *self.is_open.lock().unwrap();

        // Invalidate any delayed close before swapping the recorder it targets.
        self.close_generation.fetch_add(1, Ordering::SeqCst);
        if was_open {
            self.stop_microphone_stream();
        }

        let previous_recorder = self.recorder.lock().unwrap().replace(replacement);
        if was_open {
            if let Err(change_error) = self.start_microphone_stream() {
                // Ensure a partially opened replacement cannot retain capture
                // resources before restoring the known-good detector.
                if let Some(recorder) = self.recorder.lock().unwrap().as_mut() {
                    let _ = recorder.close();
                }
                *self.recorder.lock().unwrap() = previous_recorder;

                if let Err(rollback_error) = self.start_microphone_stream() {
                    error!(
                        "Failed to restore microphone stream after VAD backend change failed: {rollback_error}"
                    );
                }
                return Err(anyhow::anyhow!(
                    "Failed to reopen microphone with {:?} VAD: {change_error}",
                    backend
                ));
            }
        }

        info!("VAD backend changed to {:?}", backend);
        drop(state);
        Ok(())
    }

    pub fn stop_recording(&self, binding_id: &str) -> Option<Vec<f32>> {
        let mut state = self.state.lock().unwrap();

        match *state {
            RecordingState::Recording {
                binding_id: ref active,
            } if active == binding_id => {
                // Stopping (not Idle): keeps the recorder owned by this stop
                // while the trailing buffer drains, so a hot re-press cannot
                // start a second capture racing `rec.stop()`.
                self.set_state(&mut state, RecordingState::Stopping);
                drop(state);

                // Extra recording buffer: sleep before stopping to capture trailing audio
                let settings = get_settings(&self.app_handle);
                if settings.extra_recording_buffer_ms > 0 {
                    debug!(
                        "Extra recording buffer: sleeping {}ms before stopping",
                        settings.extra_recording_buffer_ms
                    );
                    std::thread::sleep(Duration::from_millis(settings.extra_recording_buffer_ms));
                }

                let samples = if let Some(rec) = self.recorder.lock().unwrap().as_ref() {
                    match rec.stop() {
                        Ok(buf) => buf,
                        Err(e) => {
                            error!("stop() failed: {e}");
                            Vec::new()
                        }
                    }
                } else {
                    error!("Recorder not available");
                    Vec::new()
                };

                let mut state = self.state.lock().unwrap();
                self.set_state(&mut state, RecordingState::Idle);
                drop(state);
                self.set_speech_frame_sender(None);

                // In on-demand mode, close the mic (lazily if configured)
                if matches!(*self.mode.lock().unwrap(), MicrophoneMode::OnDemand) {
                    if get_settings(&self.app_handle).lazy_stream_close {
                        self.schedule_lazy_close();
                    } else {
                        self.stop_microphone_stream();
                    }
                }

                // Pad if very short
                let s_len = samples.len();
                // debug!("Got {} samples", s_len);
                if s_len < WHISPER_SAMPLE_RATE && s_len > 0 {
                    let mut padded = samples;
                    padded.resize(WHISPER_SAMPLE_RATE * 5 / 4, 0.0);
                    Some(padded)
                } else {
                    Some(samples)
                }
            }
            _ => None,
        }
    }
    pub fn is_recording(&self) -> bool {
        self.recording_active.load(Ordering::SeqCst)
    }

    /// Cancel any ongoing recording without returning audio samples
    pub fn cancel_recording(&self) {
        let mut state = self.state.lock().unwrap();

        if let RecordingState::Recording { .. } = *state {
            self.set_state(&mut state, RecordingState::Stopping);
            drop(state);

            if let Some(rec) = self.recorder.lock().unwrap().as_ref() {
                let _ = rec.stop(); // Discard the result
            }

            let mut state = self.state.lock().unwrap();
            self.set_state(&mut state, RecordingState::Idle);
            drop(state);
            self.set_speech_frame_sender(None);
            self.set_online_transcription_receiver(None);

            // In on-demand mode, close the mic (lazily if configured)
            if matches!(*self.mode.lock().unwrap(), MicrophoneMode::OnDemand) {
                if get_settings(&self.app_handle).lazy_stream_close {
                    self.schedule_lazy_close();
                } else {
                    self.stop_microphone_stream();
                }
            }
        }
    }

    pub fn get_current_transcription_id(&self) -> u64 {
        self.current_transcription_id
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn increment_transcription_id(&self) -> u64 {
        self.current_transcription_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1
    }
}
