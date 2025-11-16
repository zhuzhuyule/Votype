import {
  Box,
  Button,
  Flex,
  SegmentedControl,
  Text,
  useThemeContext,
} from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { ActionWrapper } from "../../ui/ActionWraperr";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";

const APPEARANCE_OPTIONS = [
  {
    labelKey: "theme.themeMode.light",
    value: "light",
    descriptionKey: "theme.themeMode.lightDesc",
  },
  {
    labelKey: "theme.themeMode.dark",
    value: "dark",
    descriptionKey: "theme.themeMode.darkDesc",
  },
  {
    labelKey: "theme.themeMode.system",
    value: "inherit",
    descriptionKey: "theme.themeMode.systemDesc",
  },
] as const;

const ACCENT_OPTIONS = [
  { labelKey: "theme.accentColor.bronze", value: "bronze" },
  { labelKey: "theme.accentColor.indigo", value: "indigo" },
  { labelKey: "theme.accentColor.blue", value: "blue" },
  { labelKey: "theme.accentColor.purple", value: "purple" },
  { labelKey: "theme.accentColor.pink", value: "pink" },
  { labelKey: "theme.accentColor.red", value: "red" },
  { labelKey: "theme.accentColor.orange", value: "orange" },
  { labelKey: "theme.accentColor.amber", value: "amber" },
  { labelKey: "theme.accentColor.yellow", value: "yellow" },
  { labelKey: "theme.accentColor.lime", value: "lime" },
  { labelKey: "theme.accentColor.green", value: "green" },
  { labelKey: "theme.accentColor.teal", value: "teal" },
  { labelKey: "theme.accentColor.cyan", value: "cyan" },
  { labelKey: "theme.accentColor.sky", value: "sky" },
] as const;

const PANEL_OPTIONS = [
  {
    labelKey: "theme.panelStyle.translucent",
    value: "translucent",
    descriptionKey: "theme.panelStyle.translucentDesc",
  },
  {
    labelKey: "theme.panelStyle.solid",
    value: "solid",
    descriptionKey: "theme.panelStyle.solidDesc",
  },
] as const;

const RADIUS_OPTIONS = [
  {
    labelKey: "theme.cornerRadius.sharp",
    value: "none",
    descriptionKey: "theme.cornerRadius.sharpDesc",
  },
  {
    labelKey: "theme.cornerRadius.soft",
    value: "small",
    descriptionKey: "theme.cornerRadius.softDesc",
  },
  {
    labelKey: "theme.cornerRadius.default",
    value: "medium",
    descriptionKey: "theme.cornerRadius.defaultDesc",
  },
  {
    labelKey: "theme.cornerRadius.rounded",
    value: "large",
    descriptionKey: "theme.cornerRadius.roundedDesc",
  },
  {
    labelKey: "theme.cornerRadius.capsule",
    value: "full",
    descriptionKey: "theme.cornerRadius.capsuleDesc",
  },
] as const;

const SCALING_OPTIONS = ["90%", "95%", "100%", "105%", "110%"] as const;

const getOptionDescription = (
  value: string | undefined,
  options: readonly { value: string; descriptionKey?: string }[],
  t: (key: string) => string,
) => {
  const option = options.find((option) => option.value === value);
  return option?.descriptionKey ? t(option.descriptionKey) : undefined;
};

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
        <ActionWrapper className="min-w-[400px]">
          <SegmentedControl.Root
            value={appearance}
            onValueChange={(value) => onAppearanceChange(value as any)}
            size="1"
            className="w-fit"
          >
            {APPEARANCE_OPTIONS.map((option) => (
              <SegmentedControl.Item key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </ActionWrapper>
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          {getOptionDescription(appearance, APPEARANCE_OPTIONS, t) ??
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
        <ActionWrapper className="min-w-[400px]">
          <SegmentedControl.Root
            value={panelBackground}
            onValueChange={(value) => onPanelBackgroundChange(value as any)}
            size="1"
            className="w-fit"
          >
            {PANEL_OPTIONS.map((option) => (
              <SegmentedControl.Item key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </ActionWrapper>
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          {getOptionDescription(panelBackground, PANEL_OPTIONS, t) ??
            t("theme.panelStyle.description")}
        </Text>
      </SettingContainer>

      <SettingContainer
        title={t("theme.cornerRadius.title")}
        description={t("theme.cornerRadius.description")}
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper className="min-w-[400px]">
          <SegmentedControl.Root
            value={radius}
            onValueChange={(value) => onRadiusChange(value as any)}
            size="1"
            className="w-fit"
          >
            {RADIUS_OPTIONS.map((option) => (
              <SegmentedControl.Item key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </ActionWrapper>
        <Text
          size="1"
          color="gray"
          className="mt-2 max-w-prose leading-relaxed"
        >
          {getOptionDescription(radius, RADIUS_OPTIONS, t) ??
            t("theme.cornerRadius.description")}
        </Text>
      </SettingContainer>

      <SettingContainer
        title={t("theme.scaling.title")}
        description={t("theme.scaling.description")}
        layout="stacked"
        descriptionMode="inline"
      >
        <ActionWrapper className="min-w-[400px]">
          <SegmentedControl.Root
            value={scaling}
            onValueChange={(value) => onScalingChange(value as any)}
            size="1"
            className="w-fit"
          >
            {SCALING_OPTIONS.map((value) => (
              <SegmentedControl.Item key={value} value={value}>
                {value}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </ActionWrapper>
        <Text size="1" color="gray">
          {t("theme.scaling.current", { scale: scaling })}
        </Text>
      </SettingContainer>
    </SettingsGroup>
  );
};

export default ThemeSettings;
