import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { RecordingRetentionPeriod } from "../../lib/types";
import { ActionWrapper } from "../ui";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

interface RecordingRetentionPeriodProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const RecordingRetentionPeriodSelector: React.FC<RecordingRetentionPeriodProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const selectedRetentionPeriod =
      getSetting("recording_retention_period") || "never";
    const historyLimit = getSetting("history_limit") || 5;

    const handleRetentionPeriodSelect = async (period: string) => {
      await updateSetting(
        "recording_retention_period",
        period as RecordingRetentionPeriod,
      );
    };

    const retentionOptions = [
      { value: "never", label: t("recordingRetention.options.never") },
      { value: "preserve_limit", label: t("recordingRetention.options.preserveLimit", { count: historyLimit }) },
      { value: "days3", label: t("recordingRetention.options.after3Days") },
      { value: "weeks2", label: t("recordingRetention.options.after2Weeks") },
      { value: "months3", label: t("recordingRetention.options.after3Months") },
    ];

    return (
      <SettingContainer
        title={t("recordingRetention.title")}
        description={t("recordingRetention.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <ActionWrapper
          onReset={async () => {
            await updateSetting("recording_retention_period", "never");
          }}
        >
          <Dropdown
            options={retentionOptions}
            selectedValue={selectedRetentionPeriod}
            onSelect={handleRetentionPeriodSelect}
            placeholder={t("recordingRetention.placeholder")}
            disabled={isUpdating("recording_retention_period")}
          />
        </ActionWrapper>
      </SettingContainer>
    );
  });

RecordingRetentionPeriodSelector.displayName =
  "RecordingRetentionPeriodSelector";
