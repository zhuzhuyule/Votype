import { Box, Button, Flex, Text, useThemeContext } from "@radix-ui/themes";
import React from "react";
import { ActionWrapper } from "../../ui/ActionWraperr";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";

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
  {
    label: "Translucent panels",
    value: "translucent",
    description:
      "Soft glass-like cards that pull in backdrop hues for a floating feel.",
  },
  {
    label: "Solid panels",
    value: "solid",
    description: "Opaque surfaces that boost legibility in bright settings.",
  },
] as const;

const RADIUS_OPTIONS = [
  {
    label: "Sharp",
    value: "none",
    description: "Crisp corners for expert-focused workflows.",
  },
  {
    label: "Soft",
    value: "small",
    description: "Subtle rounding that keeps a structured layout.",
  },
  {
    label: "Default",
    value: "medium",
    description: "Balanced radius that works across cards and panels.",
  },
  {
    label: "Rounded",
    value: "large",
    description: "Friendly curves for a relaxed aesthetic.",
  },
  {
    label: "Capsule",
    value: "full",
    description: "Fully rounded edges that give panels a pill-like softness.",
  },
] as const;

const SCALING_OPTIONS = ["90%", "95%", "100%", "105%", "110%"] as const;

const getOptionDescription = (
  value: string | undefined,
  options: readonly { value: string; description?: string }[],
) => options.find((option) => option.value === value)?.description;

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
                variant={appearance === option.value ? "solid" : "outline"}
                size="1"
                onClick={() => onAppearanceChange(option.value as any)}
              >
                {option.label}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          {getOptionDescription(appearance, APPEARANCE_OPTIONS) ??
            "Select the light, dark, or system-driven baseline that best fits your environment."}
        </Text>
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
                variant="ghost"
                size="1"
                type="button"
                onClick={() => onAccentColorChange(option.value as any)}
                aria-label={`${option.label} accent color`}
                className={`rounded-full! p-1! m-[1px]! border! ${
                  accentColor === option.value
                    ? "border-gray-500!"
                    : "border-transparent!"
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
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          Accent colors tint controls and highlights; Handy currently uses{" "}
          <span className="font-semibold text-text">{accentColor}</span>.
        </Text>
      </SettingContainer>

      <SettingContainer
        title="Panel style"
        description="Toggle between translucent and solid toast containers."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper className="w-full">
          <Flex wrap="wrap" gap="2">
            {PANEL_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={panelBackground === option.value ? "solid" : "outline"}
                size="1"
                onClick={() => onPanelBackgroundChange(option.value as any)}
              >
                {option.label}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          {getOptionDescription(panelBackground, PANEL_OPTIONS) ??
            "Choose translucent surfaces to hint at blurred depth or solid cards for stronger contrast."}
        </Text>
      </SettingContainer>

      <SettingContainer
        title="Corner radius"
        description="Adjust the roundness of cards and panels."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper className="w-full">
          <Flex wrap="wrap" gap="2">
            {RADIUS_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={radius === option.value ? "solid" : "outline"}
                size="1"
                onClick={() => onRadiusChange(option.value as any)}
              >
                {option.label}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          {getOptionDescription(radius, RADIUS_OPTIONS) ??
            "Fine-tune corner softness to strike a balance between precision and approachability."}
        </Text>
      </SettingContainer>

      <SettingContainer
        title="Scaling"
        description="Zoom in or out on the entire UI."
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper className="w-full">
          <Flex wrap="wrap" gap="2">
            {SCALING_OPTIONS.map((value) => (
              <Button
                key={value}
                variant={scaling === value ? "solid" : "outline"}
                size="1"
                onClick={() => onScalingChange(value as any)}
              >
                {value}
              </Button>
            ))}
          </Flex>
        </ActionWrapper>
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          Selected zoom: <span className="font-semibold">{scaling}</span>.
          Higher values enlarge UI elements for better readability.
        </Text>
      </SettingContainer>
    </SettingsGroup>
  );
};

export default ThemeSettings;
