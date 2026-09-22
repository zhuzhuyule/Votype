use crate::audio_feedback;
use crate::audio_toolkit::audio::{list_input_devices, list_output_devices};
use crate::managers::audio::{AudioRecordingManager, MicrophoneMode};
use crate::settings::{get_settings, write_settings, VadBackend};
use log::warn;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct CustomSounds {
    start: bool,
    stop: bool,
}

fn custom_sound_exists(app: &AppHandle, sound_type: &str) -> bool {
    app.path()
        .resolve(
            format!("custom_{}.wav", sound_type),
            tauri::path::BaseDirectory::AppData,
        )
        .is_ok_and(|path| path.exists())
}

#[tauri::command]
pub fn check_custom_sounds(app: AppHandle) -> CustomSounds {
    CustomSounds {
        start: custom_sound_exists(&app, "start"),
        stop: custom_sound_exists(&app, "stop"),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioDevice {
    pub index: String,
    pub name: String,
    pub is_default: bool,
}

#[tauri::command]
pub async fn update_microphone_mode(app: AppHandle, always_on: bool) -> Result<(), String> {
    // Update settings
    let mut settings = get_settings(&app);
    settings.always_on_microphone = always_on;
    write_settings(&app, settings);

    // Update the audio manager mode. Blocking (device probing / stream open)
    // and off the main loop (upstream #1716).
    let rm = app.state::<Arc<AudioRecordingManager>>().inner().clone();
    let new_mode = if always_on {
        MicrophoneMode::AlwaysOn
    } else {
        MicrophoneMode::OnDemand
    };

    tokio::task::spawn_blocking(move || rm.update_mode(new_mode))
        .await
        .map_err(|e| format!("audio task join failed: {}", e))?
        .map_err(|e| format!("Failed to update microphone mode: {}", e))
}

#[tauri::command]
pub fn get_microphone_mode(app: AppHandle) -> Result<bool, String> {
    let settings = get_settings(&app);
    Ok(settings.always_on_microphone)
}

#[tauri::command]
pub async fn change_vad_backend_setting(app: AppHandle, backend: VadBackend) -> Result<(), String> {
    if get_settings(&app).vad_backend == backend {
        return Ok(());
    }

    // Construct/swap the detector and, when necessary, reopen cpal away from
    // the webview thread. Persist only after the runtime change succeeds so a
    // rejected in-progress switch or failed microphone reopen rolls back cleanly.
    let rm = app.state::<Arc<AudioRecordingManager>>().inner().clone();
    tokio::task::spawn_blocking(move || rm.update_vad_backend(backend))
        .await
        .map_err(|e| format!("audio task join failed: {}", e))?
        .map_err(|e| format!("Failed to update VAD backend: {}", e))?;

    let mut settings = get_settings(&app);
    settings.vad_backend = backend;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub async fn get_available_microphones() -> Result<Vec<AudioDevice>, String> {
    let devices = tokio::task::spawn_blocking(|| {
        list_input_devices().map_err(|e| format!("Failed to list audio devices: {}", e))
    })
    .await
    .map_err(|e| format!("audio task join failed: {}", e))??;

    let mut result = vec![AudioDevice {
        index: "default".to_string(),
        name: "Default".to_string(),
        is_default: true,
    }];

    result.extend(devices.into_iter().map(|d| AudioDevice {
        index: d.index,
        name: d.name,
        is_default: false, // The explicit default is handled separately
    }));

    Ok(result)
}

#[tauri::command]
pub async fn set_selected_microphone(
    app: AppHandle,
    device_name: String,
) -> Result<SetMicrophoneResult, String> {
    let mic_key = device_name.clone();
    let mut settings = get_settings(&app);
    settings.selected_microphone = if device_name == "default" {
        None
    } else {
        Some(device_name)
    };

    // Look up per-mic enhance preference; fall back to app default (true)
    // when this microphone has never been configured.
    let enhance = settings
        .mic_enhance_preferences
        .get(&mic_key)
        .copied()
        .unwrap_or(true);
    settings.audio_input_auto_enhance = enhance;
    write_settings(&app, settings);

    // Apply the enhance preference to the audio manager.
    if let Some(audio_manager) = app.try_state::<std::sync::Arc<AudioRecordingManager>>() {
        audio_manager.set_auto_enhance_enabled(enhance);
    }

    // Stream restart touches CoreAudio device APIs — keep it off the main
    // loop (upstream #1716).
    let rm = app.state::<Arc<AudioRecordingManager>>().inner().clone();
    tokio::task::spawn_blocking(move || rm.update_selected_device())
        .await
        .map_err(|e| format!("audio task join failed: {}", e))?
        .map_err(|e| format!("Failed to update selected device: {}", e))?;

    Ok(SetMicrophoneResult {
        audio_input_auto_enhance: enhance,
    })
}

#[derive(Serialize)]
pub struct SetMicrophoneResult {
    pub audio_input_auto_enhance: bool,
}

#[tauri::command]
pub fn get_selected_microphone(app: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app);
    Ok(settings
        .selected_microphone
        .unwrap_or_else(|| "default".to_string()))
}

#[tauri::command]
pub async fn get_available_output_devices() -> Result<Vec<AudioDevice>, String> {
    let devices = tokio::task::spawn_blocking(|| {
        list_output_devices().map_err(|e| format!("Failed to list output devices: {}", e))
    })
    .await
    .map_err(|e| format!("audio task join failed: {}", e))??;

    let mut result = vec![AudioDevice {
        index: "default".to_string(),
        name: "Default".to_string(),
        is_default: true,
    }];

    result.extend(devices.into_iter().map(|d| AudioDevice {
        index: d.index,
        name: d.name,
        is_default: false, // The explicit default is handled separately
    }));

    Ok(result)
}

#[tauri::command]
pub fn set_selected_output_device(app: AppHandle, device_name: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.selected_output_device = if device_name == "default" {
        None
    } else {
        Some(device_name)
    };
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn get_selected_output_device(app: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app);
    Ok(settings
        .selected_output_device
        .unwrap_or_else(|| "default".to_string()))
}

#[tauri::command]
pub async fn play_test_sound(app: AppHandle, sound_type: String) {
    let sound = match sound_type.as_str() {
        "start" => audio_feedback::SoundType::Start,
        "stop" => audio_feedback::SoundType::Stop,
        _ => {
            warn!("Unknown sound type: {}", sound_type);
            return;
        }
    };
    audio_feedback::play_test_sound(&app, sound);
}

#[tauri::command]
pub fn set_clamshell_microphone(app: AppHandle, device_name: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.clamshell_microphone = if device_name == "default" {
        None
    } else {
        Some(device_name)
    };
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn get_clamshell_microphone(app: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app);
    Ok(settings
        .clamshell_microphone
        .unwrap_or_else(|| "default".to_string()))
}

#[tauri::command]
pub fn is_recording(app: AppHandle) -> bool {
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    audio_manager.is_recording()
}
