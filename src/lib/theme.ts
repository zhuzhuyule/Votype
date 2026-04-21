/**
 * Shared theme utilities and constants
 * Used by both main app and overlay for consistent theming
 */

export type ThemeConfig = {
  appearance: string;
  accentColor: string;
  grayColor: string;
  panelBackground: string;
  radius: string;
  scaling: string;
  fontFamily: string;
};

export const ACCENT_COLOR_MAP: Record<string, string> = {
  gray: "#8b8d98",
  bronze: "#a18072",
  brown: "#ad7f58",
  yellow: "#f5d90a",
  amber: "#f59e0b",
  orange: "#f76b15",
  tomato: "#e54d2e",
  crimson: "#e5484d",
  pink: "#ec4899",
  purple: "#7c3aed",
  violet: "#8b5cf6",
  indigo: "#3e63dd",
  blue: "#1d4ed8",
  cyan: "#22d3ee",
  teal: "#0f766e",
  green: "#30a46c",
  lime: "#84cc16",
  mint: "#00bcd4",
};

/**
 * Curated built-in font stacks.
 *
 * Ground rules for each stack:
 * - Latin font first, CJK font second — the browser picks per-character, so a
 *   single stack handles 中英 side-by-side correctly.
 * - Every component is a system-preinstalled font on macOS and/or Windows;
 *   no web fonts, no network dependency.
 * - Each stack ends with emoji fallbacks ("Apple Color Emoji", "Segoe UI
 *   Emoji") and a generic family, so glyphs never drop to tofu.
 * - The 7 options are intentionally picked to be stylistically distinct
 *   (neutral UI / Apple sans / classic grotesque / rounded / 楷 / 宋 / 等宽).
 */
const EMOJI_FALLBACK =
  "'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'";

export const FONT_FAMILY_MAP: Record<string, string> = {
  // Balanced UI stack — the safe default on every platform.
  default: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', Roboto, ${EMOJI_FALLBACK}, sans-serif`,

  // Apple's modern UI typeface; falls back to Segoe UI on Windows.
  sfPro: `'SF Pro Text', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', ${EMOJI_FALLBACK}, sans-serif`,

  // Classic neutral grotesque — Helvetica on mac, Arial on Windows.
  helvetica: `'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', ${EMOJI_FALLBACK}, sans-serif`,

  // Soft rounded sans — macOS SF Pro Rounded, Windows degrades to Segoe UI.
  rounded: `'SF Pro Rounded', 'SF Pro Text', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', ${EMOJI_FALLBACK}, sans-serif`,

  // 楷体：书法风格，正式与休闲之间的一种风味。
  kaiti: `'Kaiti SC', STKaiti, KaiTi, 'Kaiti TC', 'BiauKai', Georgia, ${EMOJI_FALLBACK}, serif`,

  // 宋体：偏阅读的衬线风格。
  songti: `'Songti SC', STSong, SimSun, 'Source Han Serif SC', Georgia, 'Times New Roman', ${EMOJI_FALLBACK}, serif`,

  // 等宽：代码/识别度优先。
  mono: `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'PingFang SC', 'Microsoft YaHei', ${EMOJI_FALLBACK}, monospace`,
};

/**
 * Display labels for the font picker. Kept alongside the map so new fonts
 * only need to be added in one place.
 */
export const FONT_FAMILY_LABELS: Record<string, string> = {
  default: "默认（系统 UI）",
  sfPro: "SF Pro",
  helvetica: "Helvetica Neue / Arial",
  rounded: "SF Pro Rounded（圆体）",
  kaiti: "楷体 (Kaiti)",
  songti: "宋体 (Songti)",
  mono: "等宽 (Monospace)",
};

export const STORAGE_KEY = "votype_ui_theme_config";
export const DEFAULT_ACCENT_COLOR = "#3e63dd";
export const DEFAULT_FONT_FAMILY = "default";

/**
 * Get the current accent color from localStorage
 * @returns The hex color value for the current accent color
 */
export const getAccentColor = (): string => {
  if (typeof window === "undefined") {
    return DEFAULT_ACCENT_COLOR;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_ACCENT_COLOR;

    const config = JSON.parse(stored) as ThemeConfig;
    return ACCENT_COLOR_MAP[config.accentColor] ?? DEFAULT_ACCENT_COLOR;
  } catch {
    return DEFAULT_ACCENT_COLOR;
  }
};
