import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { HistoryLimit } from "../HistoryLimit";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { TranslateToEnglish } from "../TranslateToEnglish";
import { LogDirectory } from "../debug/LogDirectory";
import { LogLevelSelector } from "../debug/LogLevelSelector";
import { OfflineVadRealtimeInterval } from "../debug/OfflineVadRealtimeInterval";
import { OfflineVadRealtimeWindow } from "../debug/OfflineVadRealtimeWindow";
import { WordCorrectionThreshold } from "../debug/WordCorrectionThreshold";
import { AppProfilesContextSettings } from "../post-processing/AppProfilesContextSettings";

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { expertMode } = useSettings();

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      {/* Transcription Optimization - Expert only */}
      {expertMode && (
        <SettingsGroup
          title={t("settings.advanced.groups.transcriptionOptimization")}
        >
          <TranslateToEnglish descriptionMode="inline" grouped={true} />
          <AppProfilesContextSettings descriptionMode="inline" grouped={true} />
          <ModelUnloadTimeoutSetting descriptionMode="inline" grouped={true} />
        </SettingsGroup>
      )}

      {/* Data Management - Expert only */}
      {expertMode && (
        <SettingsGroup title={t("settings.advanced.groups.dataManagement")}>
          <HistoryLimit descriptionMode="inline" grouped={true} />
          <RecordingRetentionPeriodSelector
            descriptionMode="inline"
            grouped={true}
          />
        </SettingsGroup>
      )}

      {/* Debug Options - Expert only */}
      {expertMode && (
        <SettingsGroup title={t("settings.advanced.groups.debug")}>
          <LogDirectory descriptionMode="inline" grouped={true} />
          <LogLevelSelector descriptionMode="inline" grouped={true} />
          <WordCorrectionThreshold descriptionMode="inline" grouped={true} />
          <OfflineVadRealtimeInterval descriptionMode="inline" grouped={true} />
          <OfflineVadRealtimeWindow descriptionMode="inline" grouped={true} />
        </SettingsGroup>
      )}
    </Flex>
  );
};
