import React from "react";
import {
  useThemeStore,
  type ThemeName,
  type ThemeMode,
} from "../../stores/themeStore";
import { Card, FormRow } from "../ui";
import { ToggleSwitch } from "../ui/ToggleSwitch";

const themes: { id: ThemeName; label: string; description: string }[] = [
  {
    id: "pro-dark",
    label: "Pro Dark",
    description: "Ice blue, high-tech feel",
  },
  {
    id: "neon-pulse",
    label: "Neon Pulse",
    description: "Teal, vibrant and energetic",
  },
  {
    id: "solar-light",
    label: "Solar Light",
    description: "Amber, warm and refined",
  },
  {
    id: "mono-minimal",
    label: "Mono Minimal",
    description: "Gray, minimal and professional",
  },
  { id: "calm-blue", label: "Calm Blue", description: "Light blue, peaceful" },
];

const modes: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export const ThemeSettings: React.FC = () => {
  const { mode, theme, setMode, setTheme } = useThemeStore();

  return (
    <div className="w-full max-w-2xl space-y-lg">
      <div>
        <h2 className="text-lg font-semibold text-text mb-md">
          Theme & Appearance
        </h2>
        <p className="text-sm text-text-secondary">
          Customize the look and feel of Handy
        </p>
      </div>

      {/* Mode Selection */}
      <Card elevation={0} padding="lg">
        <FormRow
          label="Color Mode"
          helper="Choose between light, dark, or system default"
        >
          <div className="flex gap-md">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`
                  flex-1 px-md py-sm rounded-md text-sm font-medium transition-all duration-200
                  ${
                    mode === m.id
                      ? "bg-accent text-white shadow-md"
                      : "bg-background border border-border text-text hover:border-accent"
                  }
                `}
              >
                {m.label}
              </button>
            ))}
          </div>
        </FormRow>
      </Card>

      {/* Theme Selection */}
      <Card elevation={0} padding="lg">
        <FormRow
          label="Color Theme"
          helper="Select your preferred accent color theme"
        >
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`
                  p-md rounded-md text-left transition-all duration-200 border-2
                  ${
                    theme === t.id
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-accent/50"
                  }
                `}
              >
                <div className="flex items-center gap-md mb-sm">
                  <div className={`w-6 h-6 rounded-md bg-accent`} />
                  <div>
                    <p className="text-sm font-semibold text-text">{t.label}</p>
                    <p className="text-xs text-text-tertiary">
                      {t.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </FormRow>
      </Card>
    </div>
  );
};
