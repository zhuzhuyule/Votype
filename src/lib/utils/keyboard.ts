/**
 * Keyboard utility functions for handling keyboard events
 */

export type OSType = "macos" | "windows" | "linux" | "unknown";

/**
 * Extract a consistent key name from a KeyboardEvent
 * This function provides cross-platform keyboard event handling
 * and returns key names appropriate for the target operating system
 */
export const getKeyName = (
  e: KeyboardEvent,
  osType: OSType = "unknown",
): string => {
  // Handle special cases first
  if (e.code) {
    const code = e.code;

    // Handle function keys (F1-F24)
    if (code.match(/^F\d+$/)) {
      return code.toLowerCase(); // F1, F2, ..., F14, F15, etc.
    }

    // Handle regular letter keys (KeyA -> a)
    if (code.match(/^Key[A-Z]$/)) {
      return code.replace("Key", "").toLowerCase();
    }

    // Handle digit keys (Digit0 -> 0)
    if (code.match(/^Digit\d$/)) {
      return code.replace("Digit", "");
    }

    // Handle numpad digit keys (Numpad0 -> numpad 0)
    if (code.match(/^Numpad\d$/)) {
      return code.replace("Numpad", "numpad ").toLowerCase();
    }

    // Handle modifier keys - OS-specific naming
    const getModifierName = (baseModifier: string): string => {
      switch (baseModifier) {
        case "shift":
          return "shift";
        case "ctrl":
          return osType === "macos" ? "ctrl" : "ctrl";
        case "alt":
          return osType === "macos" ? "option" : "alt";
        case "meta":
          // Windows key on Windows/Linux, Command key on Mac
          if (osType === "macos") return "command";
          return "super";
        default:
          return baseModifier;
      }
    };

    const modifierMap: Record<string, string> = {
      ShiftLeft: getModifierName("shift"),
      ShiftRight: getModifierName("shift"),
      ControlLeft: getModifierName("ctrl"),
      ControlRight: getModifierName("ctrl"),
      AltLeft: getModifierName("alt"),
      AltRight: getModifierName("alt"),
      MetaLeft: getModifierName("meta"),
      MetaRight: getModifierName("meta"),
      OSLeft: getModifierName("meta"),
      OSRight: getModifierName("meta"),
      CapsLock: "caps lock",
      Tab: "tab",
      Enter: "enter",
      Space: "space",
      Backspace: "backspace",
      Delete: "delete",
      Escape: "esc",
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Home: "home",
      End: "end",
      PageUp: "page up",
      PageDown: "page down",
      Insert: "insert",
      PrintScreen: "print screen",
      ScrollLock: "scroll lock",
      Pause: "pause",
      ContextMenu: "menu",
      NumpadMultiply: "numpad *",
      NumpadAdd: "numpad +",
      NumpadSubtract: "numpad -",
      NumpadDecimal: "numpad .",
      NumpadDivide: "numpad /",
      NumLock: "num lock",
    };

    if (modifierMap[code]) {
      return modifierMap[code];
    }

    // Handle punctuation and special characters
    const punctuationMap: Record<string, string> = {
      Semicolon: ";",
      Equal: "=",
      Comma: ",",
      Minus: "-",
      Period: ".",
      Slash: "/",
      Backquote: "`",
      BracketLeft: "[",
      Backslash: "\\",
      BracketRight: "]",
      Quote: "'",
    };

    if (punctuationMap[code]) {
      return punctuationMap[code];
    }

    // For any other codes, try to convert to a reasonable format
    return code.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  // Fallback to e.key if e.code is not available
  if (e.key) {
    const key = e.key;

    // Handle special key names with OS-specific formatting
    const keyMap: Record<string, string> = {
      Control: osType === "macos" ? "ctrl" : "ctrl",
      Alt: osType === "macos" ? "option" : "alt",
      Shift: "shift",
      Meta:
        osType === "macos" ? "command" : osType === "windows" ? "win" : "super",
      OS:
        osType === "macos" ? "command" : osType === "windows" ? "win" : "super",
      CapsLock: "caps lock",
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Escape: "esc",
      " ": "space",
    };

    if (keyMap[key]) {
      return keyMap[key];
    }

    return key.toLowerCase();
  }

  // Last resort fallback
  return `unknown-${e.keyCode || e.which || 0}`;
};

/**
 * Get display-friendly key combination string for the current OS
 * Returns basic plus-separated format with correct platform key names
 */
export const formatKeyCombination = (
  combination: string = "",
  osType: OSType = "macos",
): string => {
  if (combination.startsWith("double_")) {
    const key = combination.replace("double_", "");
    const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
    return `Double ${capitalizedKey}`;
  }
  // Simply return the combination as-is since getKeyName already provides
  // the correct platform-specific key names
  return combination.replace(/ ?\+ ?/g, " + ");
};

export interface KeyToken {
  /** Raw key name */
  raw: string;
  /** Display label (symbol, icon glyph, or text) */
  label: string;
  /** Whether this is a modifier key */
  isModifier: boolean;
  /** Left/Right side indicator, if specified by backend */
  side?: "L" | "R";
}

/**
 * Platform-specific modifier display.
 *
 * Key symbols reference:
 *   ⌘  Command (macOS)           ⌃  Control
 *   ⌥  Option / Alt              ⇧  Shift
 *   ⊞  Windows logo key          ❖  Super / Meta (Linux)
 *
 * macOS:   ⌃  ⌥  ⇧  ⌘              (pure Apple symbols)
 * Windows: Ctrl  ⌥ Alt  ⇧  ⊞ Win    (symbol + text for clarity)
 * Linux:   Ctrl  Alt  ⇧  ❖ Super    (symbol + text)
 */
const MODIFIER_LABELS: Record<OSType, Record<string, string>> = {
  macos: {
    command: "⌘",
    cmd: "⌘",
    meta: "⌘",
    option: "⌥",
    alt: "⌥",
    shift: "⇧",
    ctrl: "⌃",
    control: "⌃",
  },
  windows: {
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "⌥ Alt",
    option: "⌥ Alt",
    shift: "⇧",
    meta: "⊞ Win",
    command: "⊞ Win",
    cmd: "⊞ Win",
    super: "⊞ Win",
  },
  linux: {
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Alt",
    option: "Alt",
    shift: "⇧",
    meta: "❖ Super",
    command: "❖ Super",
    cmd: "❖ Super",
    super: "❖ Super",
  },
  unknown: {
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Alt",
    option: "Alt",
    shift: "⇧ Shift",
    meta: "Meta",
    command: "Meta",
    cmd: "Meta",
    super: "Super",
  },
};

/**
 * Platform-aware labels for special (non-modifier) keys.
 * Symbols are used where universally recognizable; text otherwise.
 */
const SPECIAL_KEY_LABELS: Record<string, string> = {
  space: "␣",
  enter: "↩",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  esc: "Esc",
  escape: "Esc",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  "caps lock": "⇪",
  home: "Home",
  end: "End",
  "page up": "PgUp",
  "page down": "PgDn",
  insert: "Ins",
  "print screen": "PrtSc",
  "scroll lock": "ScrLk",
  pause: "Pause",
  menu: "☰",
  "num lock": "NumLk",
};

/** Canonical modifier names for matching */
const MODIFIER_NAMES = new Set([
  "ctrl",
  "control",
  "alt",
  "option",
  "shift",
  "command",
  "cmd",
  "meta",
  "super",
]);

/**
 * Modifier sort order per platform.
 * macOS: ⌃ ⌥ ⇧ ⌘  (Apple HIG)
 * Windows/Linux: ⊞/Super  Ctrl  Alt  ⇧  (Microsoft convention)
 */
const MODIFIER_ORDER: Record<OSType, string[]> = {
  macos: [
    "ctrl",
    "control",
    "alt",
    "option",
    "shift",
    "command",
    "cmd",
    "meta",
  ],
  windows: [
    "meta",
    "command",
    "cmd",
    "super",
    "ctrl",
    "control",
    "alt",
    "option",
    "shift",
  ],
  linux: [
    "meta",
    "command",
    "cmd",
    "super",
    "ctrl",
    "control",
    "alt",
    "option",
    "shift",
  ],
  unknown: [
    "meta",
    "command",
    "cmd",
    "super",
    "ctrl",
    "control",
    "alt",
    "option",
    "shift",
  ],
};

/**
 * Parse a key combination string into structured tokens for rendering.
 * Handles platform-specific symbols, modifier ordering, and special keys.
 */
export const parseKeyCombination = (
  combination: string = "",
  osType: OSType = "macos",
): KeyToken[] => {
  if (!combination) return [];

  if (combination.startsWith("double_")) {
    const key = combination.replace("double_", "");
    const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
    return [
      { raw: "double", label: "2×", isModifier: true },
      { raw: key, label: capitalizedKey, isModifier: false },
    ];
  }

  const parts = combination
    .split(/\s?\+\s?/)
    .map((k) => k.trim().toLowerCase());
  const modLabels = MODIFIER_LABELS[osType] || MODIFIER_LABELS.unknown;
  const order = MODIFIER_ORDER[osType] || MODIFIER_ORDER.unknown;

  const modifiers: KeyToken[] = [];
  const keys: KeyToken[] = [];

  for (const part of parts) {
    if (!part) continue;

    // Detect left/right modifier variants:
    //   "option_left", "command_right"  (handy_keys backend format)
    //   "left option", "right command"  (browser fallback format)
    let side: "L" | "R" | undefined;
    let baseName = part;

    const underscoreMatch = part.match(/^(.+)_(left|right)$/);
    const spaceMatch = part.match(/^(left|right)\s+(.+)$/);
    if (underscoreMatch) {
      const [, base, sideStr] = underscoreMatch;
      if (MODIFIER_NAMES.has(base)) {
        side = sideStr === "left" ? "L" : "R";
        baseName = base;
      }
    } else if (spaceMatch) {
      const [, sideStr, base] = spaceMatch;
      if (MODIFIER_NAMES.has(base)) {
        side = sideStr === "left" ? "L" : "R";
        baseName = base;
      }
    }

    const isModifier = MODIFIER_NAMES.has(baseName);

    let label: string;
    if (isModifier && modLabels[baseName]) {
      label = modLabels[baseName];
    } else if (SPECIAL_KEY_LABELS[baseName]) {
      label = SPECIAL_KEY_LABELS[baseName];
    } else if (/^f\d+$/.test(baseName)) {
      label = baseName.toUpperCase();
    } else if (/^numpad\s?.+$/.test(baseName)) {
      label = baseName.replace(/^numpad\s?/, "Num ");
    } else {
      label =
        baseName.length === 1
          ? baseName.toUpperCase()
          : baseName.charAt(0).toUpperCase() + baseName.slice(1);
    }

    const token: KeyToken = { raw: baseName, label, isModifier, side };
    if (isModifier) {
      modifiers.push(token);
    } else {
      keys.push(token);
    }
  }

  // Sort modifiers in platform-specific order
  modifiers.sort((a, b) => order.indexOf(a.raw) - order.indexOf(b.raw));

  return [...modifiers, ...keys];
};

/**
 * Normalize modifier keys to handle left/right variants
 */
export const normalizeKey = (key: string): string => {
  // Handle left/right variants of modifier keys
  if (key.startsWith("left ") || key.startsWith("right ")) {
    const parts = key.split(" ");
    if (parts.length === 2) {
      // Return just the modifier name without left/right prefix
      return parts[1];
    }
  }
  return key;
};
