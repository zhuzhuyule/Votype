//! Windows reliable paste — skeleton only.
//!
//! The upstream design uses delayed rendering: `SetClipboardData(CF_UNICODETEXT,
//! NULL)` makes Windows send `WM_RENDERFORMAT` to our owner window when a
//! consumer reads the clipboard, which is the receipt. That path is not ported
//! yet; returning `Err` before anything is published makes the caller fall
//! back to the legacy paste-and-restore behavior.

use crate::settings::{AutoSubmitKey, ClipboardHandling, PasteMethod};

pub(super) fn run(
    _text: &str,
    _app_handle: &tauri::AppHandle,
    _paste_method: &PasteMethod,
    _enigo: &mut enigo::Enigo,
    _auto_submit: bool,
    _auto_submit_key: AutoSubmitKey,
    _clipboard_handling: ClipboardHandling,
) -> Result<(), String> {
    Err("Windows reliable paste not ported yet".to_string())
}
