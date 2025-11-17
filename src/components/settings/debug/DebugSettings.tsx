import React from "react";
import { Box } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";
import { LogDirectory } from "./LogDirectory";
import { LogLevelSelector } from "./LogLevelSelector";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { HistoryLimit } from "../HistoryLimit";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { SoundPicker } from "../SoundPicker";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { ClamshellMicrophoneSelector } from "../ClamshellMicrophoneSelector";

export const DebugSettings: React.FC = () => {
  const { t } = useTranslation();
  
  return (
    <Box className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("debugSettings.title")}>
        <LogDirectory grouped={true} />
        <LogLevelSelector grouped={true} />
        <SoundPicker
          label={t("debugSettings.soundThemeLabel")}
          description={t("debugSettings.soundThemeDescription")}
        />
        <WordCorrectionThreshold descriptionMode="tooltip" grouped={true} />
        <HistoryLimit descriptionMode="tooltip" grouped={true} />
        <RecordingRetentionPeriodSelector
          descriptionMode="tooltip"
          grouped={true}
        />
        <AlwaysOnMicrophone descriptionMode="tooltip" grouped={true} />
        <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
    </Box>
  );
};
