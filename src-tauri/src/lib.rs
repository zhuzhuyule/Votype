mod actions;
mod active_window;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod apple_intelligence;
mod audio_feedback;
pub mod audio_toolkit;
mod clipboard;
mod commands;
mod helpers;
mod input;
mod llm_client;
mod managers;
mod online_asr;
mod overlay;
mod settings;
mod sherpa;
mod shortcut;
mod signal_handle;
mod tray;
mod utils;

use env_filter::Builder as EnvFilterBuilder;
use managers::audio::AudioRecordingManager;
use managers::history::HistoryManager;
use managers::model::ModelManager;
use managers::transcription::TranscriptionManager;
#[cfg(unix)]
use signal_hook::consts::SIGUSR2;
#[cfg(unix)]
use signal_hook::iterator::Signals;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::image::Image;

use tauri::tray::TrayIconBuilder;
use tauri::Emitter;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};

// Global atomic to store the file log level filter
// We use u8 to store the log::LevelFilter as a number
pub static FILE_LOG_LEVEL: AtomicU8 = AtomicU8::new(log::LevelFilter::Debug as u8);
pub static CONSOLE_LOG_LEVEL: AtomicU8 = AtomicU8::new(log::LevelFilter::Info as u8);

fn level_filter_from_u8(value: u8) -> log::LevelFilter {
    match value {
        0 => log::LevelFilter::Off,
        1 => log::LevelFilter::Error,
        2 => log::LevelFilter::Warn,
        3 => log::LevelFilter::Info,
        4 => log::LevelFilter::Debug,
        5 => log::LevelFilter::Trace,
        _ => log::LevelFilter::Trace,
    }
}

fn build_console_filter() -> env_filter::Filter {
    let mut builder = EnvFilterBuilder::new();

    match std::env::var("RUST_LOG") {
        Ok(spec) if !spec.trim().is_empty() => {
            if let Err(err) = builder.try_parse(&spec) {
                log::warn!(
                    "Ignoring invalid RUST_LOG value '{}': {}. Falling back to info-level console logging",
                    spec,
                    err
                );
                builder.filter_level(log::LevelFilter::Info);
            }
        }
        _ => {
            builder.filter_level(log::LevelFilter::Info);
        }
    }

    // Suppress verbose DEBUG logs from HTTP client libraries
    // These libraries log every connection attempt which floods the console
    builder.filter_module("reqwest", log::LevelFilter::Info);
    builder.filter_module("hyper", log::LevelFilter::Info);
    builder.filter_module("hyper_util", log::LevelFilter::Info);

    builder.build()
}

#[derive(Default)]
struct ShortcutToggleStates {
    // Map: shortcut_binding_id -> is_active
    active_toggles: HashMap<String, bool>,
}

type ManagedToggleState = Mutex<ShortcutToggleStates>;

fn initialize_core_logic(app_handle: &AppHandle) {
    // Initialize the input state (Enigo singleton for keyboard/mouse simulation)
    let enigo_state = input::EnigoState::new().expect("Failed to initialize input state (Enigo)");
    app_handle.manage(enigo_state);

    // Initialize the managers
    let recording_manager = Arc::new(
        AudioRecordingManager::new(app_handle).expect("Failed to initialize recording manager"),
    );
    let model_manager =
        Arc::new(ModelManager::new(app_handle).expect("Failed to initialize model manager"));
    let transcription_manager = Arc::new(
        TranscriptionManager::new(app_handle, model_manager.clone())
            .expect("Failed to initialize transcription manager"),
    );
    let history_manager =
        Arc::new(HistoryManager::new(app_handle).expect("Failed to initialize history manager"));
    let post_processing_manager = Arc::new(managers::post_processing::PostProcessingManager::new());

    // Add managers to Tauri's managed state
    app_handle.manage(recording_manager.clone());
    app_handle.manage(model_manager.clone());
    app_handle.manage(transcription_manager.clone());
    app_handle.manage(history_manager.clone());
    app_handle.manage(post_processing_manager.clone());
    app_handle.manage(tray::ManagedTrayIconState(std::sync::Mutex::new(
        tray::TrayIconState::Idle,
    )));

    // Initialize the shortcuts
    shortcut::init_shortcuts(app_handle);

    #[cfg(unix)]
    let signals = Signals::new(&[SIGUSR2]).unwrap();
    // Set up SIGUSR2 signal handler for toggling transcription
    #[cfg(unix)]
    signal_handle::setup_signal_handler(app_handle.clone(), signals);

    // Apply macOS Accessory policy if starting hidden
    #[cfg(target_os = "macos")]
    {
        let settings = settings::get_settings(app_handle);
        if settings.start_hidden {
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
    // Get the current theme to set the appropriate initial icon
    let initial_theme = tray::get_current_theme(app_handle);

    // Choose the appropriate initial icon based on theme
    let initial_icon_path = tray::get_icon_path(initial_theme, tray::TrayIconState::Idle);

    let tray = TrayIconBuilder::new()
        .icon(
            Image::from_path(
                app_handle
                    .path()
                    .resolve(initial_icon_path, tauri::path::BaseDirectory::Resource)
                    .unwrap(),
            )
            .unwrap(),
        )
        .show_menu_on_left_click(true)
        .icon_as_template(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                let _ = utils::show_or_create_main_window(app, Some("dashboard"));
            }
            "check_updates" => {
                let settings = settings::get_settings(app);
                if settings.update_checks_enabled {
                    let _ = utils::show_or_create_main_window(app, Some("dashboard"));
                    let _ = app.emit("check-for-updates", ());
                }
            }
            "cancel" => {
                use crate::utils::cancel_current_operation;

                // Use centralized cancellation that handles all operations
                cancel_current_operation(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app_handle)
        .unwrap();
    app_handle.manage(tray);

    // Initialize tray menu with idle state
    utils::update_tray_menu(app_handle, &utils::TrayIconState::Idle);

    // Get the autostart manager and configure based on user setting
    let autostart_manager = app_handle.autolaunch();
    let settings = settings::get_settings(&app_handle);

    if settings.autostart_enabled {
        // Enable autostart if user has opted in
        let _ = autostart_manager.enable();
    } else {
        // Disable autostart if user has opted out
        let _ = autostart_manager.disable();
    }

    // Create the recording overlay window (hidden by default)
    utils::create_recording_overlay(app_handle);
}

#[tauri::command]
fn trigger_update_check(app: AppHandle) -> Result<(), String> {
    let settings = settings::get_settings(&app);
    if !settings.update_checks_enabled {
        return Ok(());
    }
    app.emit("check-for-updates", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Parse console logging directives from RUST_LOG, falling back to info-level logging
    // when the variable is unset
    let console_filter = build_console_filter();

    let mut builder = tauri::Builder::default().plugin(
        LogBuilder::new()
            .level(log::LevelFilter::Trace) // Set to most verbose level globally
            .max_file_size(500_000)
            .rotation_strategy(RotationStrategy::KeepOne)
            .clear_targets()
            .targets([
                // Console output respects RUST_LOG environment variable OR dynamic console level
                Target::new(TargetKind::Stdout).filter({
                    let console_filter = console_filter.clone();
                    move |metadata| {
                        // Check RUST_LOG filter first
                        if console_filter.enabled(metadata) {
                            return true;
                        }
                        // Fallback to dynamic console level
                        let console_level = CONSOLE_LOG_LEVEL.load(Ordering::Relaxed);
                        metadata.level() <= level_filter_from_u8(console_level)
                    }
                }),
                // File logs respect the user's settings (stored in FILE_LOG_LEVEL atomic)
                Target::new(TargetKind::LogDir {
                    file_name: Some("votype".into()),
                })
                .filter(|metadata| {
                    let file_level = FILE_LOG_LEVEL.load(Ordering::Relaxed);
                    metadata.level() <= level_filter_from_u8(file_level)
                }),
            ])
            .build(),
    );

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = utils::show_or_create_main_window(app, Some("dashboard"));
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(Mutex::new(ShortcutToggleStates::default()))
        .setup(move |app| {
            let settings = settings::get_settings(&app.handle());
            let file_log_level: log::Level = settings.log_level.clone().into();
            // Store the file log level in the atomic for the filter to use
            FILE_LOG_LEVEL.store(file_log_level.to_level_filter() as u8, Ordering::Relaxed);

            // Initialize console log level based on debug_mode
            let console_level = if settings.debug_mode {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            };
            CONSOLE_LOG_LEVEL.store(console_level as u8, Ordering::Relaxed);

            let app_handle = app.handle().clone();

            initialize_core_logic(&app_handle);

            // Show main window only if not starting hidden
            if !settings.start_hidden {
                let _ = utils::show_or_create_main_window(&app_handle, Some("dashboard"));
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                // Window close behavior is controlled by settings elsewhere; do not force-hide here.
                #[cfg(target_os = "macos")]
                {
                    let res = window
                        .app_handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);
                    if let Err(e) = res {
                        log::error!("Failed to set activation policy: {}", e);
                    }
                }
            }
            tauri::WindowEvent::ThemeChanged(theme) => {
                log::info!("Theme changed to: {:?}", theme);
                // Update tray icon to match new theme, maintaining idle state
                utils::change_tray_icon(&window.app_handle(), utils::TrayIconState::Idle);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            shortcut::change_binding,
            shortcut::reset_binding,
            shortcut::change_ptt_setting,
            shortcut::change_audio_feedback_setting,
            shortcut::change_audio_feedback_volume_setting,
            shortcut::change_sound_theme_setting,
            shortcut::change_start_hidden_setting,
            shortcut::change_autostart_setting,
            shortcut::change_update_checks_setting,
            shortcut::change_onboarding_completed_setting,
            shortcut::change_translate_to_english_setting,
            shortcut::change_selected_language_setting,
            shortcut::change_app_language_setting,
            shortcut::change_overlay_position_setting,
            shortcut::change_debug_mode_setting,
            shortcut::change_word_correction_threshold_setting,
            shortcut::change_paste_method_setting,
            shortcut::change_clipboard_handling_setting,
            shortcut::change_post_process_enabled_setting,
            shortcut::change_post_process_use_secondary_output_setting,
            shortcut::change_post_process_use_local_candidate_when_online_asr_setting,
            shortcut::change_post_process_secondary_model_id_setting,
            shortcut::change_post_process_base_url_setting,
            shortcut::change_post_process_api_key_setting,
            shortcut::change_post_process_model_setting,
            shortcut::set_post_process_provider,
            shortcut::fetch_post_process_models,
            shortcut::add_custom_provider,
            shortcut::update_custom_provider,
            shortcut::remove_custom_provider,
            shortcut::add_cached_model,
            shortcut::update_cached_model_capability,
            shortcut::remove_cached_model,
            shortcut::toggle_online_asr,
            shortcut::select_asr_model,
            shortcut::select_post_process_model,
            shortcut::add_post_process_prompt,
            shortcut::update_post_process_prompt,
            shortcut::delete_post_process_prompt,
            shortcut::set_post_process_selected_prompt,
            shortcut::update_custom_words,
            shortcut::suspend_binding,
            shortcut::resume_binding,
            shortcut::change_mute_while_recording_setting,
            shortcut::change_append_trailing_space_setting,
            shortcut::change_offline_vad_force_interval_ms_setting,
            shortcut::change_offline_vad_force_window_seconds_setting,
            shortcut::change_punctuation_enabled_setting,
            shortcut::change_punctuation_model_setting,
            shortcut::change_favorite_transcription_models_setting,
            trigger_update_check,
            commands::cancel_operation,
            commands::get_app_dir_path,
            commands::get_log_dir_path,
            commands::set_log_level,
            commands::open_recordings_folder,
            commands::open_log_dir,
            commands::open_app_data_dir,
            commands::get_active_window_info,
            commands::get_cursor_position,
            commands::show_main_window,
            commands::get_first_history_entry,
            commands::paste_text_to_active_window,
            commands::models::get_available_models,
            commands::models::get_model_info,
            commands::models::download_model,
            commands::models::add_model_from_url,
            commands::models::delete_model,
            commands::models::cancel_download,
            commands::models::set_active_model,
            commands::models::get_current_model,
            commands::models::get_transcription_model_status,
            commands::models::is_model_loading,
            commands::models::has_any_models_available,
            commands::models::has_any_models_or_downloads,
            commands::models::get_recommended_first_model,
            commands::audio::update_microphone_mode,
            commands::audio::get_microphone_mode,
            commands::audio::get_available_microphones,
            commands::audio::set_selected_microphone,
            commands::audio::get_selected_microphone,
            commands::audio::get_available_output_devices,
            commands::audio::set_selected_output_device,
            commands::audio::get_selected_output_device,
            commands::audio::play_test_sound,
            commands::audio::check_custom_sounds,
            commands::audio::set_clamshell_microphone,
            commands::audio::get_clamshell_microphone,
            commands::audio::is_recording,
            helpers::clamshell::is_clamshell,
            helpers::clamshell::is_laptop,
            commands::transcription::set_model_unload_timeout,
            commands::transcription::get_model_load_status,
            commands::transcription::unload_model_manually,
            commands::history::get_history_entries,
            commands::history::get_history_dashboard_stats,
            commands::history::toggle_history_entry_saved,
            commands::history::get_audio_file_path,
            commands::history::delete_history_entry,
            commands::history::update_history_limit,
            commands::history::update_recording_retention_period,
            commands::history::retranscribe_history_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
