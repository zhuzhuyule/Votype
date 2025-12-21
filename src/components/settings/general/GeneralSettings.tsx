import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { AudioFeedback } from "../AudioFeedback";
import { LanguageSelector } from "../LanguageSelector";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PushToTalk } from "../PushToTalk";
import { SoundPicker } from "../SoundPicker";
import { VolumeSlider } from "../VolumeSlider";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      {/* Recording Settings */}
      <SettingsGroup title={t("settings.general.groups.recording")}>
        <PushToTalk descriptionMode="inline" grouped={true} />
        <AlwaysOnMicrophone descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Transcription Language */}
      <SettingsGroup title={t("settings.general.groups.transcription")}>
        <LanguageSelector descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Sound Settings */}
      <SettingsGroup title={t("settings.sound.title")}>
        <MicrophoneSelector descriptionMode="inline" grouped={true} />
        <AudioFeedback descriptionMode="inline" grouped={true} />
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
        <MuteWhileRecording descriptionMode="inline" grouped={true} />
        <OutputDeviceSelector
          descriptionMode="inline"
          grouped={true}
          disabled={!audioFeedbackEnabled}
        />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsGroup>
    </Flex>
  );
};
