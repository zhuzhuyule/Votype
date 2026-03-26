import { SegmentedControl } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ActionWrapper } from "../ui";
import { SettingContainer } from "../ui/SettingContainer";

interface ActivationModeProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const ACTIVATION_OPTIONS = [
  {
    value: "toggle",
    labelKey: "settings.general.activationMode.options.toggle",
  },
  { value: "hold", labelKey: "settings.general.activationMode.options.hold" },
  {
    value: "hold_or_toggle",
    labelKey: "settings.general.activationMode.options.holdOrToggle",
  },
] as const;

export const ActivationMode: React.FC<ActivationModeProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const currentMode = getSetting("activation_mode") || "toggle";

    return (
      <SettingContainer
        title={t("settings.general.activationMode.label")}
        description={t(
          `settings.general.activationMode.descriptions.${currentMode}`,
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
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
      </SettingContainer>
    );
  },
);

// Backward-compatible export alias
export const PushToTalk = ActivationMode;
