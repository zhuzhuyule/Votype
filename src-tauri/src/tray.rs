use crate::settings;
use log::{error, info};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Manager, Theme};

pub struct ManagedTrayIconState(pub Mutex<TrayIconState>);

pub fn version_label() -> String {
    let version = env!("CARGO_PKG_VERSION");
    if cfg!(debug_assertions) {
        format!("Votype v{} (Dev)", version)
    } else {
        format!("Votype v{}", version)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum TrayIconState {
    Idle,
    Recording,
    Transcribing,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AppTheme {
    Dark,
    Light,
    Colored, // Pink/colored theme for Linux
}

/// Gets the current app theme, with Linux defaulting to Colored theme
pub fn get_current_theme(app: &AppHandle) -> AppTheme {
    if cfg!(target_os = "linux") {
        // On Linux, always use the colored theme
        AppTheme::Colored
    } else {
        // On other platforms, map system theme to our app theme
        if let Some(main_window) = app.get_webview_window("main") {
            match main_window.theme().unwrap_or(Theme::Dark) {
                Theme::Light => AppTheme::Light,
                Theme::Dark => AppTheme::Dark,
                _ => AppTheme::Dark, // Default fallback
            }
        } else {
            AppTheme::Dark
        }
    }
}

/// Gets the appropriate icon path for the given theme and state
pub fn get_icon_path(theme: AppTheme, state: TrayIconState) -> &'static str {
    match (theme, state) {
        // Dark theme uses light icons
        (AppTheme::Dark, TrayIconState::Idle) => "resources/tray_idle.png",
        (AppTheme::Dark, TrayIconState::Recording) => "resources/tray_recording.png",
        (AppTheme::Dark, TrayIconState::Transcribing) => "resources/tray_transcribing.png",
        // Light theme uses dark icons
        (AppTheme::Light, TrayIconState::Idle) => "resources/tray_idle_dark.png",
        (AppTheme::Light, TrayIconState::Recording) => "resources/tray_recording_dark.png",
        (AppTheme::Light, TrayIconState::Transcribing) => "resources/tray_transcribing_dark.png",
        // Colored theme uses pink icons (for Linux)
        (AppTheme::Colored, TrayIconState::Idle) => "resources/votype.png",
        (AppTheme::Colored, TrayIconState::Recording) => "resources/recording.png",
        (AppTheme::Colored, TrayIconState::Transcribing) => "resources/transcribing.png",
    }
}

pub fn change_tray_icon(app: &AppHandle, icon: TrayIconState) {
    if let Ok(mut state) = app.state::<ManagedTrayIconState>().0.lock() {
        *state = icon.clone();
    }

    let tray = app.state::<TrayIcon>();
    let theme = get_current_theme(app);

    let icon_path = get_icon_path(theme, icon.clone());

    let _ = tray.set_icon(Some(
        Image::from_path(
            app.path()
                .resolve(icon_path, tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve"),
        )
        .expect("failed to set icon"),
    ));

    // Update menu based on state
    update_tray_menu(app, &icon);
}

#[derive(Clone, Copy)]
enum TrayTextKey {
    Settings,
    CheckForUpdates,
    Quit,
    Cancel,
}

fn tray_text(lang_code: &str, key: TrayTextKey) -> &'static str {
    let lang = lang_code
        .split(['-', '_'])
        .next()
        .unwrap_or("en")
        .to_lowercase();

    match (lang.as_str(), key) {
        // Chinese (Simplified)
        ("zh", TrayTextKey::Settings) => "设置...",
        ("zh", TrayTextKey::CheckForUpdates) => "检查更新...",
        ("zh", TrayTextKey::Quit) => "退出",
        ("zh", TrayTextKey::Cancel) => "取消",

        // Japanese
        ("ja", TrayTextKey::Settings) => "設定...",
        ("ja", TrayTextKey::CheckForUpdates) => "アップデートを確認...",
        ("ja", TrayTextKey::Quit) => "終了",
        ("ja", TrayTextKey::Cancel) => "キャンセル",

        // German
        ("de", TrayTextKey::Settings) => "Einstellungen...",
        ("de", TrayTextKey::CheckForUpdates) => "Nach Updates suchen...",
        ("de", TrayTextKey::Quit) => "Beenden",
        ("de", TrayTextKey::Cancel) => "Abbrechen",

        // French
        ("fr", TrayTextKey::Settings) => "Paramètres...",
        ("fr", TrayTextKey::CheckForUpdates) => "Rechercher des mises à jour...",
        ("fr", TrayTextKey::Quit) => "Quitter",
        ("fr", TrayTextKey::Cancel) => "Annuler",

        // Spanish
        ("es", TrayTextKey::Settings) => "Configuración...",
        ("es", TrayTextKey::CheckForUpdates) => "Buscar actualizaciones...",
        ("es", TrayTextKey::Quit) => "Salir",
        ("es", TrayTextKey::Cancel) => "Cancelar",

        // Vietnamese
        ("vi", TrayTextKey::Settings) => "Cài đặt...",
        ("vi", TrayTextKey::CheckForUpdates) => "Kiểm tra cập nhật...",
        ("vi", TrayTextKey::Quit) => "Thoát",
        ("vi", TrayTextKey::Cancel) => "Hủy",

        // English fallback
        (_, TrayTextKey::Settings) => "Settings...",
        (_, TrayTextKey::CheckForUpdates) => "Check for Updates...",
        (_, TrayTextKey::Quit) => "Quit",
        (_, TrayTextKey::Cancel) => "Cancel",
    }
}

pub fn update_tray_menu(app: &AppHandle, state: &TrayIconState) {
    let settings = settings::get_settings(app); // Added this line

    if let Ok(mut managed_state) = app.state::<ManagedTrayIconState>().0.lock() {
        *managed_state = state.clone();
    }

    // Platform-specific accelerators
    #[cfg(target_os = "macos")]
    let (settings_accelerator, quit_accelerator) = (Some("Cmd+,"), Some("Cmd+Q"));
    #[cfg(not(target_os = "macos"))]
    let (settings_accelerator, quit_accelerator) = (Some("Ctrl+,"), Some("Ctrl+Q"));

    // Create common menu items
    let version_label = format!("Votype v{}", env!("CARGO_PKG_VERSION"));
    let version_i = MenuItem::with_id(app, "version", &version_label, false, None::<&str>)
        .expect("failed to create version item");
    let settings_label = tray_text(&settings.app_language, TrayTextKey::Settings);
    let settings_i = MenuItem::with_id(app, "settings", settings_label, true, settings_accelerator)
        .expect("failed to create settings item");
    let check_updates_i = MenuItem::with_id(
        app,
        "check_updates",
        tray_text(&settings.app_language, TrayTextKey::CheckForUpdates),
        settings.update_checks_enabled,
        None::<&str>,
    )
    .expect("failed to create check updates item");
    let quit_i = MenuItem::with_id(
        app,
        "quit",
        tray_text(&settings.app_language, TrayTextKey::Quit),
        true,
        quit_accelerator,
    )
    .expect("failed to create quit item");
    let separator = || PredefinedMenuItem::separator(app).expect("failed to create separator");

    let menu = match state {
        TrayIconState::Recording | TrayIconState::Transcribing => {
            let cancel_i = MenuItem::with_id(
                app,
                "cancel",
                tray_text(&settings.app_language, TrayTextKey::Cancel),
                true,
                None::<&str>,
            )
            .expect("failed to create cancel item");
            Menu::with_items(
                app,
                &[
                    &version_i,
                    &separator(),
                    &cancel_i,
                    &separator(),
                    &settings_i,
                    &check_updates_i,
                    &separator(),
                    &quit_i,
                ],
            )
            .expect("failed to create menu")
        }
        TrayIconState::Idle => Menu::with_items(
            app,
            &[
                &version_i,
                &separator(),
                &settings_i,
                &check_updates_i,
                &separator(),
                &quit_i,
            ],
        )
        .expect("failed to create menu"),
    };

    let tray = app.state::<TrayIcon>();
    let _ = tray.set_menu(Some(menu));
    let _ = tray.set_icon_as_template(true);
}

pub fn set_tray_visibility(app: &AppHandle, visible: bool) {
    let tray = app.state::<TrayIcon>();
    if let Err(e) = tray.set_visible(visible) {
        error!("Failed to set tray visibility: {}", e);
    } else {
        info!("Tray visibility set to: {}", visible);
    }
}
