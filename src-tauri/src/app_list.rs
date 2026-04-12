use log::{debug, info, warn};
use once_cell::sync::Lazy;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::SystemTime;

use crate::app_category;

/// Broad input-capability category for an installed application.
/// Used to group apps in the picker so users can find the ones
/// they are likely to target with voice dictation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InputCategory {
    /// Known editors, browsers, IM, email, notes, or apps that declare
    /// document types in their Info.plist.
    InputCapable,
    /// Known terminal / shell emulator apps.
    Terminal,
    /// LSUIElement / LSBackgroundOnly apps — menu bar agents, background
    /// daemons. Usually have no main window to dictate into.
    Background,
    /// Everything else — games, media players, system utilities, etc.
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApp {
    /// Display name of the application
    pub name: String,
    /// Path to the cached PNG icon file (use convertFileSrc on frontend)
    pub icon_path: Option<String>,
    /// Bundle path (e.g. /Applications/Safari.app)
    pub bundle_path: String,
    /// Input-capability category for grouping
    pub category: InputCategory,
}

struct CacheEntry {
    apps: Vec<InstalledApp>,
    /// Max mtime observed across the scanned directories at the time of scan.
    /// A subsequent call can detect install/uninstall by comparing the
    /// current directory mtimes against this value.
    dirs_mtime: SystemTime,
}

static APP_LIST_CACHE: Lazy<Mutex<Option<CacheEntry>>> = Lazy::new(|| Mutex::new(None));

fn scan_directories() -> Vec<PathBuf> {
    let home_apps = std::env::var("HOME")
        .map(|h| PathBuf::from(h).join("Applications"))
        .unwrap_or_default();
    vec![PathBuf::from("/Applications"), home_apps]
        .into_iter()
        .filter(|p| p.exists())
        .collect()
}

/// Return the most recent mtime across all scanned directories.
/// Used to detect app install/uninstall since the last cache fill.
fn current_dirs_mtime() -> SystemTime {
    scan_directories()
        .iter()
        .filter_map(|dir| std::fs::metadata(dir).ok())
        .filter_map(|m| m.modified().ok())
        .max()
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

/// Scan /Applications and ~/Applications for .app bundles.
/// Icons are extracted as 64px PNGs and cached in `cache_dir`.
///
/// The cache is auto-invalidated when the scanned directories' mtimes
/// change (i.e. an app was installed or removed since the last scan).
/// `refresh=true` forces a rescan regardless.
pub fn list_installed_apps(cache_dir: &Path, refresh: bool) -> Vec<InstalledApp> {
    if !refresh {
        let current_mtime = current_dirs_mtime();
        if let Ok(guard) = APP_LIST_CACHE.lock() {
            if let Some(entry) = guard.as_ref() {
                if current_mtime <= entry.dirs_mtime {
                    debug!("[AppList] Cache hit ({} apps)", entry.apps.len());
                    return entry.apps.clone();
                }
                debug!("[AppList] Cache stale (dirs modified), rescanning");
            }
        }
    }

    let apps = scan_all_apps(cache_dir);
    let dirs_mtime = current_dirs_mtime();

    if let Ok(mut guard) = APP_LIST_CACHE.lock() {
        *guard = Some(CacheEntry {
            apps: apps.clone(),
            dirs_mtime,
        });
    }

    apps
}

fn scan_all_apps(cache_dir: &Path) -> Vec<InstalledApp> {
    let start = std::time::Instant::now();
    let icon_cache_dir = cache_dir.join("app-icons");
    if let Err(e) = std::fs::create_dir_all(&icon_cache_dir) {
        warn!("[AppList] Failed to create icon cache dir: {}", e);
    }

    let dirs = scan_directories();
    let mut candidates: Vec<PathBuf> = Vec::new();
    for dir in &dirs {
        match std::fs::read_dir(dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("app") {
                        candidates.push(path);
                    }
                }
            }
            Err(e) => warn!("[AppList] Failed to read {}: {}", dir.display(), e),
        }
    }

    let mut apps: Vec<InstalledApp> = candidates
        .par_iter()
        .filter_map(|path| extract_app_info(path, &icon_cache_dir))
        .collect();

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps.dedup_by(|a, b| a.name.to_lowercase() == b.name.to_lowercase());

    info!(
        "[AppList] Scanned {} apps in {:?}",
        apps.len(),
        start.elapsed()
    );
    apps
}

#[derive(Debug, Clone, Default)]
struct PlistMetadata {
    display_name: Option<String>,
    icon_file: Option<String>,
    is_ui_element: bool,
    is_background_only: bool,
    has_document_types: bool,
}

fn extract_app_info(app_path: &Path, icon_cache_dir: &Path) -> Option<InstalledApp> {
    let bundle_name = app_path.file_stem()?.to_str()?.to_string();
    let plist_path = app_path.join("Contents/Info.plist");

    let meta = read_plist_metadata(&plist_path).unwrap_or_default();
    let name = meta
        .display_name
        .clone()
        .unwrap_or_else(|| bundle_name.clone());

    let icon_path = extract_icon(
        app_path,
        meta.icon_file.as_deref(),
        icon_cache_dir,
        &bundle_name,
    );

    let category = classify(&name, &meta);

    Some(InstalledApp {
        name,
        icon_path: icon_path.map(|p| p.to_string_lossy().to_string()),
        bundle_path: app_path.to_string_lossy().to_string(),
        category,
    })
}

/// Classify app into a broad input-capability category based on
/// name-based rules plus Info.plist signals.
fn classify(name: &str, meta: &PlistMetadata) -> InputCategory {
    let name_category = app_category::from_app_name(name);

    match name_category {
        "Terminal" => InputCategory::Terminal,
        "CodeEditor" | "InstantMessaging" | "Email" | "Notes" | "Browser" => {
            InputCategory::InputCapable
        }
        _ => {
            if meta.is_ui_element || meta.is_background_only {
                InputCategory::Background
            } else if meta.has_document_types {
                InputCategory::InputCapable
            } else {
                InputCategory::Other
            }
        }
    }
}

/// Read display name, icon file, and input-signal fields from Info.plist in one pass.
fn read_plist_metadata(plist_path: &Path) -> Option<PlistMetadata> {
    let value = plist::Value::from_file(plist_path).ok()?;
    let dict = value.as_dictionary()?;

    let display_name = dict
        .get("CFBundleDisplayName")
        .and_then(|v| v.as_string())
        .or_else(|| dict.get("CFBundleName").and_then(|v| v.as_string()))
        .map(|s| s.to_string());

    let icon_file = dict
        .get("CFBundleIconFile")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string());

    let is_ui_element = dict
        .get("LSUIElement")
        .and_then(|v| match v {
            plist::Value::Boolean(b) => Some(*b),
            plist::Value::String(s) => Some(s == "1" || s.eq_ignore_ascii_case("true")),
            plist::Value::Integer(i) => i.as_signed().map(|n| n != 0),
            _ => None,
        })
        .unwrap_or(false);

    let is_background_only = dict
        .get("LSBackgroundOnly")
        .and_then(|v| match v {
            plist::Value::Boolean(b) => Some(*b),
            plist::Value::String(s) => Some(s == "1" || s.eq_ignore_ascii_case("true")),
            plist::Value::Integer(i) => i.as_signed().map(|n| n != 0),
            _ => None,
        })
        .unwrap_or(false);

    let has_document_types = dict
        .get("CFBundleDocumentTypes")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);

    Some(PlistMetadata {
        display_name,
        icon_file,
        is_ui_element,
        is_background_only,
        has_document_types,
    })
}

/// Extract app icon as a 64px PNG file cached on disk.
/// Returns cached path immediately if it exists.
fn extract_icon(
    app_path: &Path,
    icon_file: Option<&str>,
    icon_cache_dir: &Path,
    bundle_name: &str,
) -> Option<PathBuf> {
    let safe_name: String = bundle_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cache_path = icon_cache_dir.join(format!("{}.png", safe_name));

    if cache_path.exists() {
        return Some(cache_path);
    }

    let icon_filename = icon_file.map(|s| {
        if s.ends_with(".icns") {
            s.to_string()
        } else {
            format!("{}.icns", s)
        }
    });

    let icns_path = if let Some(filename) = icon_filename {
        app_path.join("Contents/Resources").join(filename)
    } else {
        let resources = app_path.join("Contents/Resources");
        ["AppIcon.icns", "app.icns", "icon.icns"]
            .iter()
            .map(|f| resources.join(f))
            .find(|p| p.exists())?
    };

    if !icns_path.exists() {
        debug!("[AppList] Icon file not found: {}", icns_path.display());
        return None;
    }

    let output = Command::new("sips")
        .args([
            "-s",
            "format",
            "png",
            "--resampleHeight",
            "64",
            icns_path.to_str()?,
            "--out",
            cache_path.to_str()?,
        ])
        .output();

    match output {
        Ok(o) if o.status.success() => Some(cache_path),
        Ok(o) => {
            debug!(
                "[AppList] sips failed for {}: {}",
                bundle_name,
                String::from_utf8_lossy(&o.stderr)
            );
            None
        }
        Err(e) => {
            debug!("[AppList] Failed to run sips for {}: {}", bundle_name, e);
            None
        }
    }
}
