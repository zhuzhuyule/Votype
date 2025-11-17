import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ActionWrapper } from "../ui";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

interface MicrophoneSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const MicrophoneSelector: React.FC<MicrophoneSelectorProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const {
      getSetting,
      updateSetting,
      resetSetting,
      isUpdating,
      isLoading,
      audioDevices,
      refreshAudioDevices,
    } = useSettings();

    const { t } = useTranslation();
    const selectedMicrophone =
      getSetting("selected_microphone") === "default"
        ? t("microphone.default")
        : getSetting("selected_microphone") || t("microphone.default");

    const handleMicrophoneSelect = async (deviceName: string) => {
      await updateSetting("selected_microphone", deviceName);
    };

    const handleReset = async () => {
      await resetSetting("selected_microphone");
    };

    const microphoneOptions = audioDevices.map((device) => ({
      value: device.name,
      label: device.name,
    }));

    return (
      <SettingContainer
        title={t("microphone.title")}
        description={t("microphone.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <ActionWrapper
          direction="row"
          onReset={handleReset}
          resetProps={{
            disabled: isUpdating("selected_microphone") || isLoading,
          }}
        >
          <Dropdown
            options={microphoneOptions}
            selectedValue={selectedMicrophone}
            onSelect={handleMicrophoneSelect}
            placeholder={
              isLoading || audioDevices.length === 0
                ? t("microphone.loading")
                : t("microphone.selectPlaceholder")
            }
            disabled={
              isUpdating("selected_microphone") ||
              isLoading ||
              audioDevices.length === 0
            }
            onRefresh={refreshAudioDevices}
          />
        </ActionWrapper>
      </SettingContainer>
    );
  },
);
