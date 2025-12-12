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

export const STORAGE_KEY = "votype_ui_theme_config";
export const DEFAULT_ACCENT_COLOR = "#3e63dd";

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
