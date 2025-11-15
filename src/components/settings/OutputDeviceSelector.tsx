import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { ActionWrapper } from "../ui";
import { useSettings } from "../../hooks/useSettings";
import { AudioDevice } from "../../lib/types";

interface OutputDeviceSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  disabled?: boolean;
}

export const OutputDeviceSelector: React.FC<OutputDeviceSelectorProps> =
  React.memo(
    ({ descriptionMode = "tooltip", grouped = false, disabled = false }) => {
      const { t } = useTranslation();
      const {
        getSetting,
        updateSetting,
        resetSetting,
        isUpdating,
        isLoading,
        outputDevices,
        refreshOutputDevices,
      } = useSettings();

      const selectedOutputDevice =
        getSetting("selected_output_device") === "default"
          ? t("outputDevice.default")
          : getSetting("selected_output_device") || t("outputDevice.default");

      const handleOutputDeviceSelect = async (deviceName: string) => {
        await updateSetting("selected_output_device", deviceName);
      };

      const handleReset = async () => {
        await resetSetting("selected_output_device");
      };

      const outputDeviceOptions = outputDevices.map((device: AudioDevice) => ({
        value: device.name,
        label: device.name,
      }));

      return (
        <SettingContainer
          title={t("outputDevice.title")}
          description={t("outputDevice.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
          disabled={disabled}
        >
          <ActionWrapper
            direction="row"
            onReset={handleReset}
            resetProps={{
              disabled: disabled || isUpdating("selected_output_device") || isLoading,
            }}
          >
            <Dropdown
              options={outputDeviceOptions}
              selectedValue={selectedOutputDevice}
              onSelect={handleOutputDeviceSelect}
              placeholder={
                isLoading || outputDevices.length === 0
                  ? t("outputDevice.loading")
                  : t("outputDevice.selectPlaceholder")
              }
              disabled={
                disabled ||
                isUpdating("selected_output_device") ||
                isLoading ||
                outputDevices.length === 0
              }
              onRefresh={refreshOutputDevices}
            />
          </ActionWrapper>
        </SettingContainer>
      );
    },
  );
