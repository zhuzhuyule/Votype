import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";

interface AudioInputAutoEnhanceProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AudioInputAutoEnhance: React.FC<AudioInputAutoEnhanceProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("audio_input_auto_enhance") ?? true;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(next) => updateSetting("audio_input_auto_enhance", next)}
        isUpdating={isUpdating("audio_input_auto_enhance")}
        label={t("settings.general.audioInputAutoEnhance.label")}
        description={t("settings.general.audioInputAutoEnhance.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });
