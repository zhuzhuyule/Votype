import React from "react";
import { type as getOsType } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface RemoteRecordToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * When enabled, the record button on BLE voice remotes (a macOS systemDefined
 * Consumer key, invisible to regular keyboard shortcuts) starts/stops
 * transcription. macOS only.
 */
export const RemoteRecordToggle: React.FC<RemoteRecordToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("remote_record_enabled") ?? true;

    if (getOsType() !== "macos") return null;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => updateSetting("remote_record_enabled", value)}
        isUpdating={isUpdating("remote_record_enabled")}
        label={t("settings.advanced.remoteRecord.label")}
        description={t("settings.advanced.remoteRecord.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
