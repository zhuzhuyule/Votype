//! A2: Accessibility snapshot of the focused editable element.
//!
//! Mirrors the status taxonomy used by Vokie's `editable-text-snapshot`
//! (`available` / `permission_denied` / `no_focused_element` / `not_editable`
//! / `value_unavailable` / `too_large` / `native_unavailable`) so failures
//! surface as stable codes instead of free-form strings. This snapshot is the
//! "pre-insert state" hook the later paste_tx reliable-paste phase will verify
//! against.

use serde::Serialize;

/// Stable failure/success codes for editor snapshots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotStatus {
    /// Success code, kept for the serialized status contract (paste_tx receipts);
    /// the Rust API signals success via `Ok` instead.
    #[allow(dead_code)]
    Available,
    PermissionDenied,
    NoFocusedElement,
    NotEditable,
    ValueUnavailable,
    TooLarge,
    NativeUnavailable,
}

impl SnapshotStatus {
    pub fn code(self) -> &'static str {
        match self {
            SnapshotStatus::Available => "available",
            SnapshotStatus::PermissionDenied => "permission_denied",
            SnapshotStatus::NoFocusedElement => "no_focused_element",
            SnapshotStatus::NotEditable => "not_editable",
            SnapshotStatus::ValueUnavailable => "value_unavailable",
            SnapshotStatus::TooLarge => "too_large",
            SnapshotStatus::NativeUnavailable => "native_unavailable",
        }
    }
}

/// AX roles considered user-editable text targets.
const EDITABLE_ROLES: &[&str] = &["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"];

/// Reject AXValue payloads larger than this (chars) before splitting.
pub const SNAPSHOT_MAX_CHARS: usize = 100_000;

fn is_editable_role(role: &str) -> bool {
    EDITABLE_ROLES.iter().any(|r| r.eq_ignore_ascii_case(role))
}

/// A snapshot of the focused editable element at one instant.
#[derive(Debug, Clone, Serialize)]
pub struct EditableSnapshot {
    /// AX role of the element (e.g. `AXTextArea`).
    pub role: String,
    /// Hex identity of the element (AXUIElementGetHash), for change detection.
    pub element_id: String,
    /// Full text content of the element.
    pub full_text: String,
    /// Selection start as a UTF-16 code-unit offset (raw AX semantics).
    pub selection_location_utf16: i64,
    /// Selection length as a UTF-16 code-unit offset (raw AX semantics).
    pub selection_length_utf16: i64,
    /// Caret/selection start converted to a `char` index into `full_text`.
    pub cursor_char: usize,
}

impl EditableSnapshot {
    /// Split full text into the parts before/after the caret (char-accurate).
    pub fn split_at_cursor(&self) -> (String, String) {
        let chars: Vec<char> = self.full_text.chars().collect();
        let pos = self.cursor_char.min(chars.len());
        (chars[..pos].iter().collect(), chars[pos..].iter().collect())
    }
}

/// Convert a UTF-16 code-unit offset into a `char` (Unicode scalar) index.
/// Offsets landing inside a surrogate pair snap to the pair's start.
fn utf16_offset_to_char_index(text: &str, utf16_offset: usize) -> usize {
    let mut remaining = utf16_offset;
    let mut char_index = 0;
    for ch in text.chars() {
        if remaining == 0 {
            break;
        }
        let width = ch.len_utf16();
        if remaining < width {
            break;
        }
        remaining -= width;
        char_index += 1;
    }
    char_index
}

#[cfg(target_os = "macos")]
pub fn snapshot_focused_editor() -> Result<EditableSnapshot, SnapshotStatus> {
    use core_foundation::base::CFRelease;
    use std::ffi::c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXValueGetValue(value: *mut c_void, value_type: u32, value_ptr: *mut c_void) -> bool;
    }

    // AXUIElementGetHash is a private API absent from the SDK stubs; a direct
    // extern reference fails at link time, so resolve it from the runtime with dlsym.
    type AxGetHashFn = unsafe extern "C" fn(element: *mut c_void, hash: *mut usize) -> i32;

    fn ax_get_hash() -> Option<AxGetHashFn> {
        use std::sync::OnceLock;
        static CACHED: OnceLock<Option<AxGetHashFn>> = OnceLock::new();
        *CACHED.get_or_init(|| {
            #[link(name = "System")]
            extern "C" {
                fn dlsym(handle: *mut c_void, symbol: *const std::os::raw::c_char) -> *mut c_void;
            }
            // RTLD_DEFAULT = (void *) -2
            let sym = unsafe { dlsym(-2isize as *mut c_void, c"AXUIElementGetHash".as_ptr()) };
            if sym.is_null() {
                None
            } else {
                Some(unsafe { std::mem::transmute::<*mut c_void, AxGetHashFn>(sym) })
            }
        })
    }

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct AxCFRange {
        location: i64,
        length: i64,
    }

    // kAXValueCFRangeType
    const K_AX_VALUE_CF_RANGE_TYPE: u32 = 4;
    // AXError codes we need to interpret
    const K_AX_ERROR_API_DISABLED: i32 = -25211;
    const K_AX_ERROR_NO_VALUE: i32 = -25212;
    const K_AX_ERROR_ATTRIBUTE_UNSUPPORTED: i32 = -25205;

    if unsafe { !AXIsProcessTrusted() } {
        return Err(SnapshotStatus::PermissionDenied);
    }

    unsafe {
        let system_element = AXUIElementCreateSystemWide();
        if system_element.is_null() {
            return Err(SnapshotStatus::NativeUnavailable);
        }

        let focused = match copy_attribute(system_element, "AXFocusedUIElement") {
            Ok(v) => v,
            Err(err) => {
                CFRelease(system_element);
                return Err(match err {
                    e if e == K_AX_ERROR_API_DISABLED => SnapshotStatus::PermissionDenied,
                    _ => SnapshotStatus::NoFocusedElement,
                });
            }
        };

        let role = match copy_string_attribute(focused, "AXRole") {
            Some(role) => role,
            None => {
                CFRelease(focused);
                CFRelease(system_element);
                return Err(SnapshotStatus::NoFocusedElement);
            }
        };
        if !is_editable_role(&role) {
            CFRelease(focused);
            CFRelease(system_element);
            return Err(SnapshotStatus::NotEditable);
        }

        let full_text = match copy_string_attribute(focused, "AXValue") {
            Some(text) => text,
            None => {
                CFRelease(focused);
                CFRelease(system_element);
                return Err(SnapshotStatus::ValueUnavailable);
            }
        };
        if full_text.chars().count() > SNAPSHOT_MAX_CHARS {
            CFRelease(focused);
            CFRelease(system_element);
            return Err(SnapshotStatus::TooLarge);
        }

        let range_ref = match copy_attribute(focused, "AXSelectedTextRange") {
            Ok(v) => v,
            Err(err) => {
                CFRelease(focused);
                CFRelease(system_element);
                return Err(
                    if err == K_AX_ERROR_ATTRIBUTE_UNSUPPORTED || err == K_AX_ERROR_NO_VALUE {
                        SnapshotStatus::NotEditable
                    } else if err == K_AX_ERROR_API_DISABLED {
                        SnapshotStatus::PermissionDenied
                    } else {
                        SnapshotStatus::ValueUnavailable
                    },
                );
            }
        };
        let mut range = AxCFRange {
            location: 0,
            length: 0,
        };
        let extracted = AXValueGetValue(
            range_ref,
            K_AX_VALUE_CF_RANGE_TYPE,
            &mut range as *mut _ as *mut c_void,
        );
        CFRelease(range_ref);
        if !extracted || range.location < 0 {
            CFRelease(focused);
            CFRelease(system_element);
            return Err(SnapshotStatus::ValueUnavailable);
        }

        let mut hash: usize = 0;
        let element_id = match ax_get_hash() {
            Some(f) if f(focused, &mut hash) == 0 => format!("{:016x}", hash),
            _ => String::new(),
        };

        CFRelease(focused);
        CFRelease(system_element);

        let cursor_char = utf16_offset_to_char_index(&full_text, range.location as usize);
        Ok(EditableSnapshot {
            role,
            element_id,
            full_text,
            selection_location_utf16: range.location,
            selection_length_utf16: range.length,
            cursor_char,
        })
    }
}

#[cfg(target_os = "macos")]
unsafe fn copy_attribute(
    element: *mut std::ffi::c_void,
    attr: &str,
) -> Result<*mut std::ffi::c_void, i32> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: core_foundation::string::CFStringRef,
            value: *mut *mut c_void,
        ) -> i32;
    }

    let name = CFString::new(attr);
    let mut value: *mut c_void = ptr::null_mut();
    let err = AXUIElementCopyAttributeValue(element, name.as_concrete_TypeRef(), &mut value);
    if err == 0 && !value.is_null() {
        Ok(value)
    } else {
        Err(err)
    }
}

#[cfg(target_os = "macos")]
unsafe fn copy_string_attribute(element: *mut std::ffi::c_void, attr: &str) -> Option<String> {
    use core_foundation::base::{CFGetTypeID, TCFType};
    use core_foundation::string::{CFString, CFStringRef};

    let value = copy_attribute(element, attr).ok()?;
    if CFGetTypeID(value as *const _) != CFString::type_id() {
        return None;
    }
    // wrap_under_create_rule takes ownership; Drop releases the CFString.
    Some(CFString::wrap_under_create_rule(value as CFStringRef).to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn snapshot_focused_editor() -> Result<EditableSnapshot, SnapshotStatus> {
    Err(SnapshotStatus::NativeUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_codes_match_vokie_taxonomy() {
        assert_eq!(SnapshotStatus::Available.code(), "available");
        assert_eq!(SnapshotStatus::PermissionDenied.code(), "permission_denied");
        assert_eq!(
            SnapshotStatus::NoFocusedElement.code(),
            "no_focused_element"
        );
        assert_eq!(SnapshotStatus::NotEditable.code(), "not_editable");
        assert_eq!(SnapshotStatus::ValueUnavailable.code(), "value_unavailable");
        assert_eq!(SnapshotStatus::TooLarge.code(), "too_large");
        assert_eq!(
            SnapshotStatus::NativeUnavailable.code(),
            "native_unavailable"
        );
    }

    #[test]
    fn editable_roles_accepted_case_insensitive() {
        assert!(is_editable_role("AXTextArea"));
        assert!(is_editable_role("axtextfield"));
        assert!(is_editable_role("AXComboBox"));
        assert!(is_editable_role("AXSearchField"));
        assert!(!is_editable_role("AXButton"));
        assert!(!is_editable_role("AXStaticText"));
        assert!(!is_editable_role(""));
    }

    #[test]
    fn utf16_offset_maps_surrogates() {
        // "a😀b": utf-16 widths 1, 2, 1
        let text = "a\u{1F600}b";
        assert_eq!(utf16_offset_to_char_index(text, 0), 0);
        assert_eq!(utf16_offset_to_char_index(text, 1), 1);
        assert_eq!(utf16_offset_to_char_index(text, 3), 2);
        assert_eq!(utf16_offset_to_char_index(text, 4), 3);
        // offset inside the surrogate pair snaps to the pair start
        assert_eq!(utf16_offset_to_char_index(text, 2), 1);
        // beyond the end clamps to the last char index
        assert_eq!(utf16_offset_to_char_index(text, 99), 3);
    }

    #[test]
    fn split_at_cursor_is_char_accurate() {
        let snap = EditableSnapshot {
            role: "AXTextArea".into(),
            element_id: "0000000000000000".into(),
            full_text: "前😀后".into(),
            selection_location_utf16: 3, // after the emoji pair
            selection_length_utf16: 0,
            cursor_char: utf16_offset_to_char_index("前😀后", 3),
        };
        let (before, after) = snap.split_at_cursor();
        assert_eq!(before, "前\u{1F600}");
        assert_eq!(after, "后");
    }

    #[test]
    fn split_clamps_out_of_range_cursor() {
        let snap = EditableSnapshot {
            role: "AXTextArea".into(),
            element_id: String::new(),
            full_text: "abc".into(),
            selection_location_utf16: 500,
            selection_length_utf16: 0,
            cursor_char: 500,
        };
        let (before, after) = snap.split_at_cursor();
        assert_eq!(before, "abc");
        assert!(after.is_empty());
    }
}
