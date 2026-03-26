import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ActionWrapper } from "../ui";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

interface ActivationModeProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ActivationMode: React.FC<ActivationModeProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const currentMode = getSetting("activation_mode") || "toggle";

    const options = [
      {
        value: "toggle",
        label: t("settings.general.activationMode.options.toggle"),
      },
      {
        value: "hold",
        label: t("settings.general.activationMode.options.hold"),
      },
      {
        value: "hold_or_toggle",
        label: t("settings.general.activationMode.options.holdOrToggle"),
      },
    ];

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
          <Dropdown
            options={options}
            selectedValue={currentMode}
            onSelect={(value) =>
              updateSetting(
                "activation_mode",
                value as "toggle" | "hold" | "hold_or_toggle",
              )
            }
            disabled={isUpdating("activation_mode")}
          />
        </ActionWrapper>
      </SettingContainer>
    );
  },
);

// Backward-compatible export alias
export const PushToTalk = ActivationMode;
