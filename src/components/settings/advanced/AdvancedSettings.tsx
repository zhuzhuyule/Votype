import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { AutostartToggle } from "../AutostartToggle";
import { ClipboardHandlingSetting } from "../ClipboardHandling";
import { CustomWords } from "../CustomWords";
import { HistoryLimit } from "../HistoryLimit";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { PasteMethodSetting } from "../PasteMethod";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { ShowOverlay } from "../ShowOverlay";
import { StartHidden } from "../StartHidden";
import { TranslateToEnglish } from "../TranslateToEnglish";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { LogDirectory } from "../debug/LogDirectory";
import { LogLevelSelector } from "../debug/LogLevelSelector";
import { OfflineVadRealtimeInterval } from "../debug/OfflineVadRealtimeInterval";
import { OfflineVadRealtimeWindow } from "../debug/OfflineVadRealtimeWindow";
import { WordCorrectionThreshold } from "../debug/WordCorrectionThreshold";
import { AppProfilesContextSettings } from "../post-processing/AppProfilesContextSettings";

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      {/* Startup Behavior */}
      <SettingsGroup title={t("settings.advanced.groups.startup")}>
        <StartHidden descriptionMode="inline" grouped={true} />
        <AutostartToggle descriptionMode="inline" grouped={true} />
        <ShowOverlay descriptionMode="inline" grouped={true} />
        <UpdateChecksToggle descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Input/Output */}
      <SettingsGroup title={t("settings.advanced.groups.inputOutput")}>
        <PasteMethodSetting descriptionMode="inline" grouped={true} />
        <ClipboardHandlingSetting descriptionMode="inline" grouped={true} />
        <AppendTrailingSpace descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Transcription Optimization */}
      <SettingsGroup
        title={t("settings.advanced.groups.transcriptionOptimization")}
      >
        <TranslateToEnglish descriptionMode="inline" grouped={true} />
        <AppProfilesContextSettings descriptionMode="inline" grouped={true} />
        <ModelUnloadTimeoutSetting descriptionMode="inline" grouped={true} />
        <CustomWords descriptionMode="inline" grouped />
      </SettingsGroup>

      {/* Data Management */}
      <SettingsGroup title={t("settings.advanced.groups.dataManagement")}>
        <HistoryLimit descriptionMode="inline" grouped={true} />
        <RecordingRetentionPeriodSelector
          descriptionMode="inline"
          grouped={true}
        />
      </SettingsGroup>

      {/* Debug Options */}
      <SettingsGroup title={t("settings.advanced.groups.debug")}>
        <LogDirectory descriptionMode="inline" grouped={true} />
        <LogLevelSelector descriptionMode="inline" grouped={true} />
        <WordCorrectionThreshold descriptionMode="inline" grouped={true} />
        <OfflineVadRealtimeInterval descriptionMode="inline" grouped={true} />
        <OfflineVadRealtimeWindow descriptionMode="inline" grouped={true} />
      </SettingsGroup>
    </Flex>
  );
};
