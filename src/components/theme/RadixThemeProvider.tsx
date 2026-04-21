import { Theme, type ThemeProps, useThemeContext } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACCENT_COLOR_MAP,
  FONT_FAMILY_MAP,
  DEFAULT_FONT_FAMILY,
  STORAGE_KEY,
} from "../../lib/theme";

type ThemeAppearance = NonNullable<ThemeProps["appearance"]>;
type ThemeAccentColor = NonNullable<ThemeProps["accentColor"]>;
type ThemeGrayColor = NonNullable<ThemeProps["grayColor"]>;
type ThemePanelBackground = NonNullable<ThemeProps["panelBackground"]>;
type ThemeRadius = NonNullable<ThemeProps["radius"]>;
type ThemeScaling = NonNullable<ThemeProps["scaling"]>;

type ThemeConfig = {
  appearance: ThemeAppearance;
  accentColor: ThemeAccentColor;
  grayColor: ThemeGrayColor;
  panelBackground: ThemePanelBackground;
  radius: ThemeRadius;
  scaling: ThemeScaling;
  fontFamily: string;
};

const DEFAULT_THEME: ThemeConfig = {
  appearance: "dark",
  accentColor: "indigo",
  grayColor: "auto",
  panelBackground: "translucent",
  radius: "medium",
  scaling: "100%",
  fontFamily: DEFAULT_FONT_FAMILY,
};

const IS_BROWSER =
  typeof window !== "undefined" && typeof document !== "undefined";

const loadStoredTheme = (): ThemeConfig => {
  if (!IS_BROWSER) {
    return DEFAULT_THEME;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_THEME;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ThemeConfig>;
    return { ...DEFAULT_THEME, ...parsed };
  } catch {
    return DEFAULT_THEME;
  }
};

export const RadixThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() =>
    loadStoredTheme(),
  );
  const [systemAppearance, setSystemAppearance] = useState<"light" | "dark">(
    () => {
      if (!IS_BROWSER) return "light";
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    },
  );

  const resolvedAppearance = useMemo(() => {
    if (themeConfig.appearance === "inherit") {
      return systemAppearance;
    }
    return themeConfig.appearance;
  }, [themeConfig.appearance, systemAppearance]);

  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      setSystemAppearance(query.matches ? "dark" : "light");
    };

    updateSystemTheme();
    query.addEventListener("change", updateSystemTheme);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const newConfig = JSON.parse(e.newValue);
          setThemeConfig((prev) => ({ ...prev, ...newConfig }));
        } catch (err) {
          console.error("Failed to parse synced theme config:", err);
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      query.removeEventListener("change", updateSystemTheme);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(themeConfig));
  }, [themeConfig]);

  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    const root = document.documentElement;
    root.dataset.theme = resolvedAppearance;
  }, [resolvedAppearance]);

  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    const root = document.documentElement;
    const accentColor = ACCENT_COLOR_MAP[themeConfig.accentColor] ?? "#3e63dd";
    root.style.setProperty("--color-logo-primary", accentColor);
    root.style.setProperty("--color-logo-stroke", accentColor);
  }, [themeConfig.accentColor]);

  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    const stack =
      FONT_FAMILY_MAP[themeConfig.fontFamily] ??
      FONT_FAMILY_MAP[DEFAULT_FONT_FAMILY];

    // Radix Themes declares --default-font-family on `.radix-themes`, so a value
    // set on :root gets shadowed inside every Radix scope. Inject (or reuse) a
    // stylesheet targeting `.radix-themes` so our override wins the cascade and
    // propagates to every Radix component. Also expose the stack on :root for
    // non-Radix CSS that reads `--font-family-base`.
    document.documentElement.style.setProperty("--font-family-base", stack);

    const STYLE_ID = "votype-font-override";
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `.radix-themes { --default-font-family: ${stack}; --font-family-base: ${stack}; }`;
  }, [themeConfig.fontFamily]);

  const updateThemeConfig = useCallback((updates: Partial<ThemeConfig>) => {
    setThemeConfig((prev) => {
      const next = { ...prev, ...updates };
      const keys = Object.keys(updates) as (keyof ThemeConfig)[];
      const hasChanges = keys.some((key) => prev[key] !== next[key]);
      return hasChanges ? next : prev;
    });
  }, []);

  const themeContextValue = useMemo<ThemeContextValue>(
    () => ({
      theme: themeConfig.appearance,
      setTheme: (appearance) => updateThemeConfig({ appearance }),
      fontFamily: themeConfig.fontFamily,
      setFontFamily: (fontFamily) => updateThemeConfig({ fontFamily }),
      accentColor: themeConfig.accentColor,
      updateThemeConfig,
    }),
    [
      themeConfig.appearance,
      themeConfig.fontFamily,
      themeConfig.accentColor,
      updateThemeConfig,
    ],
  );

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <Theme
        appearance={resolvedAppearance}
        accentColor={themeConfig.accentColor}
        grayColor={themeConfig.grayColor}
        panelBackground={themeConfig.panelBackground}
        radius={themeConfig.radius}
        scaling={themeConfig.scaling}
        hasBackground={false}
      >
        <ThemeStateSync onThemeChange={updateThemeConfig}>
          <div className="min-h-screen" data-theme={resolvedAppearance}>
            {children}
          </div>
        </ThemeStateSync>
      </Theme>
    </ThemeContext.Provider>
  );
};

type ThemeContextValue = {
  theme: ThemeAppearance;
  setTheme: (theme: ThemeAppearance) => void;
  fontFamily: string;
  setFontFamily: (fontFamily: string) => void;
  accentColor: ThemeAccentColor;
  updateThemeConfig: (updates: Partial<ThemeConfig>) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export const useTheme = () => {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a RadixThemeProvider");
  }
  return context;
};

type ThemeStateSyncProps = {
  onThemeChange: (config: Partial<ThemeConfig>) => void;
  children: React.ReactNode;
};

const ThemeStateSync: React.FC<ThemeStateSyncProps> = ({
  onThemeChange,
  children,
}) => {
  const { accentColor, grayColor, panelBackground, radius, scaling } =
    useThemeContext();

  useEffect(() => {
    onThemeChange({
      accentColor,
      grayColor,
      panelBackground,
      radius,
      scaling,
    });
  }, [accentColor, grayColor, panelBackground, radius, scaling, onThemeChange]);

  return <>{children}</>;
};
