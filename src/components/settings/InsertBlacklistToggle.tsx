import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface InsertBlacklistToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * When enabled, blacklisted apps (terminals, editors that intercept synthetic
 * typing) fall back to clipboard paste instead of direct text insertion.
 */
export const InsertBlacklistToggle: React.FC<InsertBlacklistToggleProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("insert_blacklist_enabled") ?? true;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => updateSetting("insert_blacklist_enabled", value)}
        isUpdating={isUpdating("insert_blacklist_enabled")}
        label={t("settings.advanced.insertBlacklist.label")}
        description={t("settings.advanced.insertBlacklist.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });
