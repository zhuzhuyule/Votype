import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui";
import { Dropdown, type DropdownOption } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";

const LOG_LEVEL_OPTIONS: DropdownOption[] = [
  { value: "5", label: "Error" },
  { value: "4", label: "Warn" },
  { value: "3", label: "Info" },
  { value: "2", label: "Debug" },
  { value: "1", label: "Trace" },
];

interface LogLevelSelectorProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const LogLevelSelector: React.FC<LogLevelSelectorProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { settings, updateSetting, isUpdating } = useSettings();
  const currentLevel = settings?.log_level ?? 2;
  const isLevelUpdating = isUpdating("log_level");

  const selectedValue = currentLevel.toString();

  const handleSelect = async (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed === currentLevel) {
      return;
    }

    try {
      await updateSetting("log_level", parsed as typeof currentLevel);
    } catch (error) {
      console.error("Failed to update log level:", error);
    }
  };

  return (
    <SettingContainer
      title={t("settings.debug.logLevel.title")}
      description={t("settings.debug.logLevel.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="horizontal"
    >
      <ActionWrapper>
        <Dropdown
          options={LOG_LEVEL_OPTIONS}
          selectedValue={selectedValue}
          onSelect={handleSelect}
          disabled={!settings || isLevelUpdating}
        />
      </ActionWrapper>
    </SettingContainer>
  );
};
