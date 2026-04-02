import {
  Box,
  Flex,
  IconButton,
  SegmentedControl,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { IconHelpCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ActionWrapper } from "../ui";

interface ActivationModeProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const ACTIVATION_OPTIONS = [
  {
    value: "hold_or_toggle",
    labelKey: "settings.general.activationMode.options.holdOrToggle",
    descKey: "settings.general.activationMode.descriptions.hold_or_toggle",
  },
  {
    value: "toggle",
    labelKey: "settings.general.activationMode.options.toggle",
    descKey: "settings.general.activationMode.descriptions.toggle",
  },
  {
    value: "hold",
    labelKey: "settings.general.activationMode.options.hold",
    descKey: "settings.general.activationMode.descriptions.hold",
  },
] as const;

export const ActivationMode: React.FC<ActivationModeProps> = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const currentMode = getSetting("activation_mode") || "toggle";
  const label = t("settings.general.activationMode.label");

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
      <Flex gap="2" align="center" style={{ minWidth: 0 }}>
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
        <Tooltip
          content={
            <Flex direction="column" gap="2" style={{ maxWidth: 280 }}>
              <Text size="2" weight="medium">
                {t("settings.general.activationMode.tooltip.summary")}
              </Text>
              <Flex direction="column" gap="1">
                {ACTIVATION_OPTIONS.map((opt) => (
                  <Text
                    key={opt.value}
                    size="1"
                    style={{
                      lineHeight: "1.4",
                      fontWeight: currentMode === opt.value ? "600" : "normal",
                      opacity: currentMode === opt.value ? 1 : 0.75,
                    }}
                  >
                    {t(opt.labelKey)}：{t(opt.descKey)}
                  </Text>
                ))}
              </Flex>
            </Flex>
          }
          delayDuration={200}
          side="top"
          sideOffset={8}
        >
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            className="w-4 h-4 p-0 text-mid-gray hover:text-logo-primary transition-colors duration-200 rounded"
            aria-label={label}
          >
            <IconHelpCircle width={16} height={16} />
          </IconButton>
        </Tooltip>
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
              >
                {t(option.labelKey)}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </ActionWrapper>
      </Box>
    </Flex>
  );
});

// Backward-compatible export alias
export const PushToTalk = ActivationMode;
