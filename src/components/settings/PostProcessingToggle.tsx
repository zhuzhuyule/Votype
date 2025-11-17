import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface PostProcessingToggleProps {
  grouped?: boolean;
}

export const PostProcessingToggle: React.FC<PostProcessingToggleProps> =
  React.memo(({ grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("post_process_enabled") || false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(enabled) => updateSetting("post_process_enabled", enabled)}
        isUpdating={isUpdating("post_process_enabled")}
        label={t("postProcess.title")}
        description={t("postProcess.description")}
        descriptionMode={"tooltip"}
        tooltipPosition="top"
        grouped={grouped}
      />
    );
  });
