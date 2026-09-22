import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import type { Settings } from "../../lib/types";
import { SettingContainer } from "../ui/SettingContainer";
import { Dropdown } from "../ui/Dropdown";

type VadBackend = Settings["vad_backend"];

interface VadBackendSelectorProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const VadBackendSelector: React.FC<VadBackendSelectorProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const selectedBackend = getSetting("vad_backend") ?? "silero";

  const options = [
    {
      value: "silero",
      label: t("settings.advanced.vadBackend.options.silero"),
    },
    {
      value: "earshot",
      label: t("settings.advanced.vadBackend.options.earshot"),
    },
  ];

  return (
    <SettingContainer
      title={t("settings.advanced.vadBackend.title")}
      description={t("settings.advanced.vadBackend.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="horizontal"
    >
      <Dropdown
        options={options}
        selectedValue={selectedBackend}
        onSelect={(value) => updateSetting("vad_backend", value as VadBackend)}
        disabled={isUpdating("vad_backend")}
      />
    </SettingContainer>
  );
};
