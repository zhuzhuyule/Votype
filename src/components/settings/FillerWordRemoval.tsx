import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface FillerWordRemovalProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Removes spoken filler words (嗯、呃、um…) from transcriptions before
 * post-processing. Language-gated: only applies to languages we detect
 * reliable filler patterns for.
 */
export const FillerWordRemoval: React.FC<FillerWordRemovalProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("filler_word_removal_enabled") ?? true;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) =>
          updateSetting("filler_word_removal_enabled", value)
        }
        isUpdating={isUpdating("filler_word_removal_enabled")}
        label={t("settings.advanced.fillerWordRemoval.label")}
        description={t("settings.advanced.fillerWordRemoval.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
