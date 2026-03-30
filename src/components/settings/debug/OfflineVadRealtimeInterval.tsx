import React, { useEffect, useState } from "react";
import { TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui/ActionWrapper";
import { SettingContainer } from "../../ui/SettingContainer";

interface OfflineVadRealtimeIntervalProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const OfflineVadRealtimeInterval: React.FC<OfflineVadRealtimeIntervalProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const saved = getSetting("offline_vad_force_interval_ms") ?? 1000;
    const [tempValue, setTempValue] = useState(String(saved));

    useEffect(() => {
      setTempValue(String(saved));
    }, [saved]);

    const handleBlur = () => {
      const value = Number.parseInt(tempValue, 10);
      if (Number.isNaN(value) || value < 0) {
        setTempValue(String(saved));
        return;
      }
      if (value !== saved) {
        updateSetting("offline_vad_force_interval_ms", value);
      }
    };

    const handleReset = () => {
      setTempValue("1000");
      updateSetting("offline_vad_force_interval_ms", 1000);
    };

    return (
      <SettingContainer
        title={t("settings.debug.offlineVadRealtime.intervalLabel")}
        description={t("settings.debug.offlineVadRealtime.intervalDescription")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="horizontal"
      >
        <ActionWrapper onReset={handleReset}>
          <TextField.Root
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onBlur={handleBlur}
            disabled={isUpdating("offline_vad_force_interval_ms")}
          />
        </ActionWrapper>
      </SettingContainer>
    );
  });

OfflineVadRealtimeInterval.displayName = "OfflineVadRealtimeInterval";
