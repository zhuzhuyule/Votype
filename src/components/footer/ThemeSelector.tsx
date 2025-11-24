import { IconDeviceLaptop, IconMoon, IconSun } from "@tabler/icons-react";
import {
  Box,
  Button,
  Flex,
  Grid,
  IconButton,
  Popover,
  ScrollArea,
  SegmentedControl,
  Text,
  useThemeContext,
} from "@radix-ui/themes";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { UI_LANGUAGE_STORAGE_KEY } from "../../i18n/config";

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

const detectPreferredLanguage = () => {
  if (typeof window === "undefined") {
    return "en";
  }
  const navLang = navigator.language || "en";
  const normalized = navLang.split("-")[0].toLowerCase();
  return normalized === "zh" ? "zh" : "en";
};

export const ThemeSelector: React.FC = () => {
  const { t } = useTranslation();
  const {
    appearance,
    accentColor,
    radius,
    scaling,
    onAppearanceChange,
    onAccentColorChange,
    onRadiusChange,
    onScalingChange,
  } = useThemeContext();

  const [language, setLanguage] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "system";
    }
    const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return stored ?? "system";
  });

  useEffect(() => {
    const handler = () => {
      if (typeof window === "undefined") return;
      setLanguage(
        window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY) ?? "system"
      );
    };
    i18n.on("languageChanged", handler);
    return () => {
      i18n.off("languageChanged", handler);
    };
  }, []);

  const handleLanguageChange = (value: string) => {
    if (value === "system") {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(UI_LANGUAGE_STORAGE_KEY);
      }
      const preferred = detectPreferredLanguage();
      i18n.changeLanguage(preferred);
    } else {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, value);
      }
      i18n.changeLanguage(value);
    }
    setLanguage(value);
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
        <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: "80vh", padding: 16 }}>
          <Flex direction="column" gap="4" pr="2">
          {/* Appearance Mode */}
          <Box>
            <Text size="1" weight="bold" mb="2" as="div">
              {t("theme.themeMode.title")}
            </Text>
            <SegmentedControl.Root
              value={appearance}
              onValueChange={(val) => onAppearanceChange(val as any)}
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

          {/* Interface Language */}
          <Box>
            <Text size="1" weight="bold" mb="2" as="div">
              {t("uiLanguage.title")}
            </Text>
            <SegmentedControl.Root
              value={language}
              onValueChange={handleLanguageChange}
              size="1"
            >
              <SegmentedControl.Item value="system">
                {t("uiLanguage.system")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="en">
                {t("uiLanguage.english")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="zh">
                {t("uiLanguage.chinese")}
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
                    <Text size="1" weight={accentColor === color ? "bold" : "regular"}>
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
                <SegmentedControl.Item key={opt.value} value={opt.value} className="b border- ">
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
