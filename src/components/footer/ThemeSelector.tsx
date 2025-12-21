import {
  Box,
  Button,
  Flex,
  Grid,
  IconButton,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Switch,
  Text,
  useThemeContext,
} from "@radix-ui/themes";
import { IconDeviceLaptop, IconMoon, IconSun } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "../../i18n";
import { useCompactMode } from "../theme/CompactModeProvider";
import { useTheme } from "../theme/RadixThemeProvider";

const STORAGE_KEY = "votype-app-language";

const ACCENT_OPTIONS = [
  "gray",
  "bronze",
  "brown",
  "yellow",
  "amber",
  "orange",
  "tomato",
  "crimson",
  "pink",
  "purple",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "mint",
] as const;

const RADIUS_OPTIONS = [
  { labelKey: "theme.cornerRadius.sharp", value: "none" },
  { labelKey: "theme.cornerRadius.soft", value: "small" },
  { labelKey: "theme.cornerRadius.default", value: "medium" },
  { labelKey: "theme.cornerRadius.rounded", value: "large" },
  { labelKey: "theme.cornerRadius.capsule", value: "full" },
] as const;

const SCALING_OPTIONS = ["90%", "95%", "100%", "105%", "110%"] as const;

export const ThemeSelector: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { theme: appearance, setTheme: setAppearance } = useTheme();
  const { compactMode, toggleCompactMode } = useCompactMode();
  const {
    accentColor,
    radius,
    scaling,
    onAccentColorChange,
    onRadiusChange,
    onScalingChange,
  } = useThemeContext();

  const currentLanguage = i18n.language as SupportedLanguageCode;

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    localStorage.setItem(STORAGE_KEY, langCode);
    void invoke("change_app_language_setting", { language: langCode });
  };

  const getIcon = () => {
    switch (appearance) {
      case "light":
        return <IconSun width="16" height="16" />;
      case "dark":
        return <IconMoon width="16" height="16" />;
      default:
        return <IconDeviceLaptop width="16" height="16" />;
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger>
        <IconButton variant="ghost" color="gray" size="1">
          {getIcon()}
        </IconButton>
      </Popover.Trigger>
      <Popover.Content size="1" style={{ minWidth: 360, padding: 0 }}>
        <ScrollArea
          type="auto"
          scrollbars="vertical"
          style={{ maxHeight: "80vh", padding: 16 }}
        >
          <Flex direction="column" gap="4" pr="2">
            {/* Compact Mode - no description, just toggle */}
            <Flex gap="4" justify="start" align="center">
              <Text size="1" weight="bold">
                {t("theme.compactMode.title")}
              </Text>
              <Switch
                checked={compactMode}
                onCheckedChange={() => toggleCompactMode()}
                size="1"
              />
            </Flex>
            {/* Language Selector */}
            <Flex gap="4" justify="between" align="center">
              <Text size="1" weight="bold">
                {t("appLanguage.title")}
              </Text>
              <Select.Root
                value={currentLanguage}
                onValueChange={handleLanguageChange}
              >
                <Select.Trigger style={{ flex: 1 }} />
                <Select.Content>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <Select.Item key={lang.code} value={lang.code}>
                      {lang.nativeName} ({lang.name})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            {/* Appearance Mode */}
            <Box>
              <Text size="1" weight="bold" mb="2" as="div">
                {t("theme.themeMode.title")}
              </Text>
              <SegmentedControl.Root
                value={appearance}
                onValueChange={(val) =>
                  setAppearance(val as "light" | "dark" | "inherit")
                }
                size="1"
              >
                <SegmentedControl.Item value="light">
                  <Flex align="center" gap="2">
                    <IconSun width={12} height={12} />
                    {t("theme.themeMode.light")}
                  </Flex>
                </SegmentedControl.Item>
                <SegmentedControl.Item value="dark">
                  <Flex align="center" gap="2">
                    <IconMoon width={12} height={12} />
                    {t("theme.themeMode.dark")}
                  </Flex>
                </SegmentedControl.Item>
                <SegmentedControl.Item value="inherit">
                  <Flex align="center" gap="2">
                    <IconDeviceLaptop width={12} height={12} />
                    {t("theme.themeMode.system")}
                  </Flex>
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </Box>

            {/* Accent Color */}
            <Box>
              <Text size="1" weight="bold" mb="2" as="div">
                {t("theme.accentColor.title")}
              </Text>
              <Grid columns="3" gap="2">
                {ACCENT_OPTIONS.map((color) => (
                  <Button
                    key={color}
                    variant={accentColor === color ? "soft" : "outline"}
                    color={accentColor === color ? undefined : "gray"}
                    onClick={() => onAccentColorChange(color as any)}
                    style={{
                      cursor: "pointer",
                      justifyContent: "start",
                      height: "32px",
                    }}
                  >
                    <Flex align="center" gap="2" width="100%">
                      <Box
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "4px",
                          backgroundColor: `var(--${color}-9)`,
                        }}
                      />
                      <Text
                        size="1"
                        weight={accentColor === color ? "bold" : "regular"}
                      >
                        {t(`theme.accentColor.${color}`)}
                      </Text>
                    </Flex>
                  </Button>
                ))}
              </Grid>
            </Box>

            {/* Radius */}
            <Box>
              <Text size="1" weight="bold" mb="2" as="div">
                {t("theme.cornerRadius.title")}
              </Text>
              <SegmentedControl.Root
                value={radius}
                onValueChange={(val) => onRadiusChange(val as any)}
                size="1"
              >
                {RADIUS_OPTIONS.map((opt) => (
                  <SegmentedControl.Item
                    key={opt.value}
                    value={opt.value}
                    className="b border- "
                  >
                    {t(opt.labelKey)}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </Box>

            {/* Scaling */}
            <Box>
              <Text size="1" weight="bold" mb="2" as="div">
                {t("theme.scaling.title")}
              </Text>
              <SegmentedControl.Root
                value={scaling}
                onValueChange={(val) => onScalingChange(val as any)}
                size="1"
              >
                {SCALING_OPTIONS.map((scale) => (
                  <SegmentedControl.Item key={scale} value={scale}>
                    {scale}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </Box>
          </Flex>
        </ScrollArea>
      </Popover.Content>
    </Popover.Root>
  );
};
