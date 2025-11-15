import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { TextField } from "@radix-ui/themes";
import { SettingContainer } from "../ui/SettingContainer";
import { ActionWrapper } from "../ui/ActionWraperr";

interface HistoryLimitProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const HistoryLimit: React.FC<HistoryLimitProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const historyLimit = getSetting("history_limit") ?? 5;

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (!isNaN(value) && value >= 0) {
      updateSetting("history_limit", value);
    }
  };

  const handleReset = () => {
    updateSetting("history_limit", 5);
  };

  return (
    <SettingContainer
      title={t("historyLimit.title")}
      description={t("historyLimit.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="horizontal"
    >
      <ActionWrapper onReset={handleReset}>
        <TextField.Root
          value={historyLimit.toString()}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const numValue = parseInt(event.target.value || "0", 10);
            if (!isNaN(numValue) && numValue >= 0) {
              updateSetting("history_limit", numValue);
            }
          }}
          disabled={isUpdating("history_limit")}
        />
      </ActionWrapper>
    </SettingContainer>
  );
};
