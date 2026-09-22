import { type as getOsType } from "@tauri-apps/plugin-os";
import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { useSettings } from "../../../hooks/useSettings";

interface ReliablePasteProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Receipt-sequenced paste (beta): the previous clipboard is restored only
 * after the paste target actually reads the transcript, instead of after a
 * fixed delay. macOS/Windows only; falls back to the legacy paste when the
 * transaction cannot start.
 */
export const ReliablePaste: React.FC<ReliablePasteProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    // The receipt-sequenced paste path is implemented for macOS and Windows.
    const osType = getOsType();
    if (osType !== "macos" && osType !== "windows") {
      return null;
    }

    return (
      <ToggleSwitch
        checked={getSetting("reliable_paste") ?? false}
        onChange={(enabled) => updateSetting("reliable_paste", enabled)}
        isUpdating={isUpdating("reliable_paste")}
        label={t("settings.debug.reliablePaste.title")}
        description={t("settings.debug.reliablePaste.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);

ReliablePaste.displayName = "ReliablePaste";
