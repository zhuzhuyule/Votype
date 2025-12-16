import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AudioFeedback } from "../AudioFeedback";
import { AppLanguageSelector } from "../AppLanguageSelector";
import { LanguageSelector } from "../LanguageSelector";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PushToTalk } from "../PushToTalk";
import { VolumeSlider } from "../VolumeSlider";
import { SoundPicker } from "../SoundPicker";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { MuteWhileRecording } from "../MuteWhileRecording";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.general.groups.language")}>
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
        <LanguageSelector descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.general.groups.input")}>
        <PushToTalk descriptionMode="tooltip" grouped={true} />
        <AlwaysOnMicrophone descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.sound.title")}>
        <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <AudioFeedback descriptionMode="tooltip" grouped={true} />
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
        <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
        <OutputDeviceSelector
          descriptionMode="tooltip"
          grouped={true}
          disabled={!audioFeedbackEnabled}
        />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsGroup>

    </Flex>
  );
};
