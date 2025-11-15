import { Box, Button, Flex, Text, useThemeContext } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { ActionWrapper } from "../../ui/ActionWraperr";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";

const APPEARANCE_OPTIONS = [
  {
    labelKey: "theme.themeMode.light",
    label: "Light",
    value: "light",
    descriptionKey: "theme.themeMode.lightDesc",
    description: "Bright background with elevated contrast",
  },
  {
    labelKey: "theme.themeMode.dark",
    label: "Dark",
    value: "dark",
    descriptionKey: "theme.themeMode.darkDesc",
    description: "Low-light friendly with deep surfaces",
  },
  {
    labelKey: "theme.themeMode.system",
    label: "System",
    value: "inherit",
    descriptionKey: "theme.themeMode.systemDesc",
    description: "Follow the operating system theme",
  },
] as const;

const ACCENT_OPTIONS = [
  { labelKey: "theme.accentColor.indigo", label: "Indigo", value: "indigo" },
  { labelKey: "theme.accentColor.blue", label: "Blue", value: "blue" },
  { labelKey: "theme.accentColor.teal", label: "Teal", value: "teal" },
  { labelKey: "theme.accentColor.cyan", label: "Cyan", value: "cyan" },
  { labelKey: "theme.accentColor.pink", label: "Pink", value: "pink" },
  { labelKey: "theme.accentColor.amber", label: "Amber", value: "amber" },
] as const;

const PANEL_OPTIONS = [
  {
    labelKey: "theme.panelStyle.translucent",
    value: "translucent",
    descriptionKey: "theme.panelStyle.translucentDesc",
    description: "Soft glass-like cards that pull in backdrop hues for a floating feel.",
  },
  {
    labelKey: "theme.panelStyle.solid",
    value: "solid",
    descriptionKey: "theme.panelStyle.solidDesc",
    description: "Opaque surfaces that boost legibility in bright settings.",
  },
] as const;

const RADIUS_OPTIONS = [
  {
    labelKey: "theme.cornerRadius.sharp",
    label: "Sharp",
    value: "none",
    descriptionKey: "theme.cornerRadius.sharpDesc",
    description: "Crisp corners for expert-focused workflows.",
  },
  {
    labelKey: "theme.cornerRadius.soft",
    label: "Soft",
    value: "small",
    descriptionKey: "theme.cornerRadius.softDesc",
    description: "Subtle rounding that keeps a structured layout.",
  },
  {
    labelKey: "theme.cornerRadius.default",
    label: "Default",
    value: "medium",
    descriptionKey: "theme.cornerRadius.defaultDesc",
    description: "Balanced radius that works across cards and panels.",
  },
  {
    labelKey: "theme.cornerRadius.rounded",
    label: "Rounded",
    value: "large",
    descriptionKey: "theme.cornerRadius.roundedDesc",
    description: "Friendly curves for a relaxed aesthetic.",
  },
  {
    labelKey: "theme.cornerRadius.capsule",
    label: "Capsule",
    value: "full",
    descriptionKey: "theme.cornerRadius.capsuleDesc",
    description: "Fully rounded edges that give panels a pill-like softness.",
  },
] as const;

const SCALING_OPTIONS = ["90%", "95%", "100%", "105%", "110%"] as const;

const getOptionDescription = (
  value: string | undefined,
  options: readonly { value: string; description?: string }[],
) => options.find((option) => option.value === value)?.description;

export const ThemeSettings: React.FC = () => {
  const { t } = useTranslation();
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
    <SettingsGroup title={t("theme.title")}>
      <SettingContainer
        title={t("theme.themeMode.title")}
        description={t("theme.themeMode.description")}
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
                {t(option.labelKey)}
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
            t("theme.themeMode.description")}
        </Text>
      </SettingContainer>

      <SettingContainer
        title={t("theme.accentColor.title")}
        description={t("theme.accentColor.description")}
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
                aria-label={`${t(option.labelKey)} accent color`}
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
          {t("theme.accentColor.current", { color: accentColor })}
        </Text>
      </SettingContainer>

      <SettingContainer
        title={t("theme.panelStyle.title")}
        description={t("theme.panelStyle.description")}
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
                {t(option.labelKey)}
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
            t("theme.panelStyle.description")}
        </Text>
      </SettingContainer>

      <SettingContainer
        title={t("theme.cornerRadius.title")}
        description={t("theme.cornerRadius.description")}
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
                {t(option.labelKey)}
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
            t("theme.cornerRadius.description")}
        </Text>
      </SettingContainer>

      <SettingContainer
        title={t("theme.scaling.title")}
        description={t("theme.scaling.description")}
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
          {t("theme.scaling.current", { scale: scaling })}
        </Text>
      </SettingContainer>
    </SettingsGroup>
  );
};

export default ThemeSettings;
