import { useThemeContext } from "@radix-ui/themes";
import React from "react";
import { Button } from "../../ui/Button";
import { SettingContainer } from "../../ui/SettingContainer";
import { ActionWrapper } from "../../ui/ActionWraperr";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Box, Flex } from "@radix-ui/themes";

const APPEARANCE_OPTIONS = [
  {
    label: "Light",
    value: "light",
    description: "Bright background with elevated contrast",
  },
  {
    label: "Dark",
    value: "dark",
    description: "Low-light friendly with deep surfaces",
  },
  {
    label: "System",
    value: "inherit",
    description: "Follow the operating system theme",
  },
] as const;

const ACCENT_OPTIONS = [
  { label: "Indigo", value: "indigo" },
  { label: "Blue", value: "blue" },
  { label: "Teal", value: "teal" },
  { label: "Cyan", value: "cyan" },
  { label: "Pink", value: "pink" },
  { label: "Amber", value: "amber" },
] as const;

const PANEL_OPTIONS = [
  { label: "Translucent panels", value: "translucent" },
  { label: "Solid panels", value: "solid" },
] as const;

const RADIUS_OPTIONS = [
  { label: "Sharp", value: "none" },
  { label: "Soft", value: "small" },
  { label: "Default", value: "medium" },
  { label: "Rounded", value: "large" },
] as const;

const SCALING_OPTIONS = ["90%", "95%", "100%", "105%", "110%"] as const;

export const ThemeSettings: React.FC = () => {
  const {
    appearance,
    accentColor,
    panelBackground,
    radius,
    scaling,
    onAppearanceChange,
    onAccentColorChange,
    onPanelBackgroundChange,
    onRadiusChange,
    onScalingChange,
  } = useThemeContext();

  return (
    <SettingsGroup title="Appearance">
      <SettingContainer
        title="Theme mode"
        description="Pick a light or dark baseline for the entire UI."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper>
          <Flex wrap="wrap" gap="2">
            {APPEARANCE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={appearance === option.value ? "primary" : "secondary"}
                size="sm"
                onClick={() => onAppearanceChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title="Accent color"
        description="Controls highlights, buttons, and active states."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper className="w-full">
          <Flex wrap="wrap" gap="2">
            {ACCENT_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={"ghost"}
                size="sm"
                type="button"
                onClick={() => onAccentColorChange(option.value)}
                aria-label={`${option.label} accent color`}
                className={`rounded-full! p-1! m-[1px]! border! ${
                  accentColor === option.value ? "border-gray-500!":"border-transparent!"
                }`}
              >
                <Box
                  height="30px"
                  width="30px"
                  className="rounded-full border border-mid-gray/40"
                  style={{
                    backgroundColor: `var(--${option.value}-9, #94a3b8)`,
                  }}
                />
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title="Panel style"
        description="Toggle between translucent and solid toast containers."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper>
          <Flex wrap="wrap" gap="2">
            {PANEL_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={
                  panelBackground === option.value ? "primary" : "secondary"
                }
                size="sm"
                onClick={() => onPanelBackgroundChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title="Corner radius"
        description="Adjust the roundness of cards and panels."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper>
          <Flex wrap="wrap" gap="2">
            {RADIUS_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={radius === option.value ? "primary" : "secondary"}
                size="sm"
                onClick={() => onRadiusChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title="Scaling"
        description="Zoom in or out on the entire UI."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper>
          <Flex wrap="wrap" gap="2">
            {SCALING_OPTIONS.map((value) => (
              <Button
                key={value}
                variant={scaling === value ? "primary" : "secondary"}
                size="sm"
                onClick={() => onScalingChange(value)}
              >
                {value}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
      </SettingContainer>
    </SettingsGroup>
  );
};
