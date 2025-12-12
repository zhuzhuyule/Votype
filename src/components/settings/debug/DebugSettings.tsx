import { Box } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { HistoryLimit } from "../HistoryLimit";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { SoundPicker } from "../SoundPicker";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { VotypeShortcut } from "../VotypeShortcut";
import { LogDirectory } from "./LogDirectory";
import { LogLevelSelector } from "./LogLevelSelector";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";

export const DebugSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const pushToTalk = getSetting("push_to_talk");

  return (
    <Box className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("debugSettings.title")}>
        <LogDirectory grouped={true} />
        <LogLevelSelector grouped={true} />
        <UpdateChecksToggle descriptionMode="tooltip" grouped={true} />
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
        <AppendTrailingSpace descriptionMode="tooltip" grouped={true} />
        <VotypeShortcut
          shortcutId="cancel"
          grouped={true}
          disabled={pushToTalk}
        />
      </SettingsGroup>
    </Box>
  );
};
