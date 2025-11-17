import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { TextField } from "@radix-ui/themes";
import { SettingContainer } from "../ui/SettingContainer";
import { ActionWrapper } from "../ui/ActionWrapper";

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

  const savedHistoryLimit = getSetting("history_limit") ?? 5;
  const [tempValue, setTempValue] = useState(savedHistoryLimit.toString());

  // Sync with saved value when it changes from elsewhere
  useEffect(() => {
    setTempValue(savedHistoryLimit.toString());
  }, [savedHistoryLimit]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setTempValue(event.target.value);
  };

  const handleBlur = async () => {
    const value = parseInt(tempValue, 10);
    if (!isNaN(value) && value >= 0 && value !== savedHistoryLimit) {
      updateSetting("history_limit", value);
    } else if (isNaN(value) || value < 0) {
      // Reset to valid value if invalid
      setTempValue(savedHistoryLimit.toString());
    }
  };

  const handleReset = () => {
    setTempValue("5");
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
          value={tempValue}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={isUpdating("history_limit")}
        />
      </ActionWrapper>
    </SettingContainer>
  );
};
