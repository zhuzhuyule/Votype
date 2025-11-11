import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName =
  | "pro-dark"
  | "neon-pulse"
  | "solar-light"
  | "mono-minimal"
  | "calm-blue";
export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  theme: ThemeName;
  setMode: (mode: ThemeMode) => void;
  setTheme: (theme: ThemeName) => void;
  getEffectiveMode: () => "light" | "dark";
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "system",
      theme: "pro-dark",

      setMode: (mode: ThemeMode) => {
        set({ mode });
        applyTheme(get().theme, get().getEffectiveMode());
      },

      setTheme: (theme: ThemeName) => {
        set({ theme });
        applyTheme(theme, get().getEffectiveMode());
      },

      getEffectiveMode: () => {
        const state = get();
        if (state.mode === "system") {
          return window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
        }
        return state.mode;
      },
    }),
    {
      name: "handy-theme",
      version: 1,
    },
  ),
);

// Apply theme to document
export function applyTheme(
  themeName: ThemeName,
  mode: "light" | "dark" = "light",
) {
  const root = document.documentElement;

  // Remove all theme classes
  root.classList.remove(
    "theme-pro-dark",
    "theme-neon-pulse",
    "theme-solar-light",
    "theme-mono-minimal",
    "theme-calm-blue",
  );

  // Apply new theme
  if (themeName !== "pro-dark") {
    root.classList.add(`theme-${themeName}`);
  }

  // Apply mode
  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

// Watch system theme changes
if (typeof window !== "undefined") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", (e) => {
    const state = useThemeStore.getState();
    if (state.mode === "system") {
      applyTheme(state.theme, e.matches ? "dark" : "light");
    }
  });

  // Apply initial theme on mount
  const state = useThemeStore.getState();
  applyTheme(state.theme, state.getEffectiveMode());
}
