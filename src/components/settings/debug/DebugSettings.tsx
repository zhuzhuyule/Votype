import { Box } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { HistoryLimit } from "../HistoryLimit";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { SoundPicker } from "../SoundPicker";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { LogDirectory } from "./LogDirectory";
import { LogLevelSelector } from "./LogLevelSelector";
import { OfflineVadRealtimeInterval } from "./OfflineVadRealtimeInterval";
import { OfflineVadRealtimeWindow } from "./OfflineVadRealtimeWindow";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";

export const DebugSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Box className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.debug.title")}>
        <LogDirectory grouped={true} />
        <LogLevelSelector grouped={true} />
        <UpdateChecksToggle descriptionMode="tooltip" grouped={true} />
        <OfflineVadRealtimeInterval descriptionMode="tooltip" grouped={true} />
        <OfflineVadRealtimeWindow descriptionMode="tooltip" grouped={true} />
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
        <WordCorrectionThreshold descriptionMode="tooltip" grouped={true} />
        <HistoryLimit descriptionMode="tooltip" grouped={true} />
        <RecordingRetentionPeriodSelector
          descriptionMode="tooltip"
          grouped={true}
        />
        <AlwaysOnMicrophone descriptionMode="tooltip" grouped={true} />
        <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
        <AppendTrailingSpace descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
    </Box>
  );
};
