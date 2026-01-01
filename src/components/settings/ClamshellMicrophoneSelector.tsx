import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import {
  normalizeDeviceValue,
  toDeviceDropdownOptions,
} from "./utils/deviceOptions";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

interface ClamshellMicrophoneSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ClamshellMicrophoneSelector: React.FC<ClamshellMicrophoneSelectorProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const {
      getSetting,
      updateSetting,
      resetSetting,
      isUpdating,
      isLoading,
      audioDevices,
      refreshAudioDevices,
    } = useSettings();

    const [isLaptop, setIsLaptop] = useState<boolean>(false);

    useEffect(() => {
      const checkIsLaptop = async () => {
        try {
          const result = await invoke<boolean>("is_laptop");
          setIsLaptop(result);
        } catch (error) {
          console.error("Failed to check if device is laptop:", error);
          setIsLaptop(false);
        }
      };

      checkIsLaptop();
    }, []);

    // Only render on laptops
    if (!isLaptop) {
      return null;
    }

    const selectedClamshellMicrophone = normalizeDeviceValue(
      getSetting("clamshell_microphone"),
    );

    const handleClamshellMicrophoneSelect = async (deviceName: string) => {
      await updateSetting("clamshell_microphone", deviceName);
    };

    const handleReset = async () => {
      await resetSetting("clamshell_microphone");
    };

    const microphoneOptions = toDeviceDropdownOptions(
      audioDevices,
      t("common.default"),
    );

    return (
      <SettingContainer
        title={t("settings.debug.clamshellMicrophone.title")}
        description={t("settings.debug.clamshellMicrophone.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="flex items-center space-x-1">
          <Dropdown
            options={microphoneOptions}
            selectedValue={selectedClamshellMicrophone}
            onSelect={handleClamshellMicrophoneSelect}
            placeholder={
              isLoading || audioDevices.length === 0
                ? t("settings.sound.microphone.loading")
                : t("settings.sound.microphone.placeholder")
            }
            disabled={
              isUpdating("clamshell_microphone") ||
              isLoading ||
              audioDevices.length === 0
            }
            onRefresh={refreshAudioDevices}
          />
        </div>
      </SettingContainer>
    );
  });

ClamshellMicrophoneSelector.displayName = "ClamshellMicrophoneSelector";
