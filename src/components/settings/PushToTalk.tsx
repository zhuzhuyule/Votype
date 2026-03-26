import { Box, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ActionWrapper } from "../ui";
import { TooltipIcon } from "../ui/TooltipIcon";

interface ActivationModeProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const ACTIVATION_OPTIONS = [
  {
    value: "toggle",
    labelKey: "settings.general.activationMode.options.toggle",
  },
  {
    value: "hold",
    labelKey: "settings.general.activationMode.options.hold",
  },
  {
    value: "hold_or_toggle",
    labelKey: "settings.general.activationMode.options.holdOrToggle",
  },
] as const;

export const ActivationMode: React.FC<ActivationModeProps> = React.memo(
  ({ grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const currentMode = getSetting("activation_mode") || "toggle";
    const label = t("settings.general.activationMode.label");

    // Build detailed help text for tooltip with all modes explained
    const helpText = ACTIVATION_OPTIONS.map(
      (opt) =>
        `${t(opt.labelKey)}: ${t(`settings.general.activationMode.descriptions.${opt.value}`)}`,
    ).join("\n");

    return (
      <Flex
        py="2"
        px="0"
        align="center"
        justify="between"
        direction="row"
        gap="4"
        style={{ width: "100%", minHeight: "44px" }}
      >
        <Flex gap="3" align="center" style={{ flex: 1, minWidth: 0 }}>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Flex align="center" gap="2">
              <Text
                size="2"
                weight="medium"
                style={{
                  lineHeight: "1.5",
                  color: "var(--gray-12)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </Text>
              <TooltipIcon text={label} description={helpText} />
            </Flex>
            <Text
              size="1"
              color="gray"
              style={{
                lineHeight: "1.4",
                display: "block",
                marginTop: "1px",
              }}
            >
              {t(`settings.general.activationMode.descriptions.${currentMode}`)}
            </Text>
          </Box>
        </Flex>

        <Box style={{ flexShrink: 0, marginLeft: "auto" }}>
          <ActionWrapper>
            <SegmentedControl.Root
              value={currentMode}
              onValueChange={(value) =>
                updateSetting(
                  "activation_mode",
                  value as "toggle" | "hold" | "hold_or_toggle",
                )
              }
              size="1"
            >
              {ACTIVATION_OPTIONS.map((option) => (
                <SegmentedControl.Item
                  key={option.value}
                  value={option.value}
                  disabled={isUpdating("activation_mode")}
                >
                  {t(option.labelKey)}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
          </ActionWrapper>
        </Box>
      </Flex>
    );
  },
);

// Backward-compatible export alias
export const PushToTalk = ActivationMode;
