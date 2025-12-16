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

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.advanced.groups.behavior")}>
        <StartHidden descriptionMode="tooltip" grouped={true} />
        <AutostartToggle descriptionMode="tooltip" grouped={true} />
        <ShowOverlay descriptionMode="tooltip" grouped={true} />
        <UpdateChecksToggle descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.input")}>
        <PasteMethodSetting descriptionMode="tooltip" grouped={true} />
        <ClipboardHandlingSetting descriptionMode="tooltip" grouped={true} />
        <AppendTrailingSpace descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.transcription")}>
        <TranslateToEnglish descriptionMode="tooltip" grouped={true} />
        <ModelUnloadTimeoutSetting descriptionMode="tooltip" grouped={true} />
        <CustomWords descriptionMode="tooltip" grouped />
        <WordCorrectionThreshold descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.data")}>
        <HistoryLimit descriptionMode="tooltip" grouped={true} />
        <RecordingRetentionPeriodSelector
          descriptionMode="tooltip"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.system")}>
        <LogDirectory grouped={true} />
        <LogLevelSelector grouped={true} />
        <OfflineVadRealtimeInterval descriptionMode="tooltip" grouped={true} />
        <OfflineVadRealtimeWindow descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
    </Flex>
  );
};
