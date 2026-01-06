import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { AudioFeedback } from "../AudioFeedback";
import { AutostartToggle } from "../AutostartToggle";
import { ClipboardHandlingSetting } from "../ClipboardHandling";
import { LanguageSelector } from "../LanguageSelector";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PasteMethodSetting } from "../PasteMethod";
import { PushToTalk } from "../PushToTalk";
import { ShowOverlay } from "../ShowOverlay";
import { SoundPicker } from "../SoundPicker";
import { StartHidden } from "../StartHidden";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { VolumeSlider } from "../VolumeSlider";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      {/* Starting Up */}
      <SettingsGroup title={t("settings.advanced.groups.startup")}>
        <StartHidden descriptionMode="inline" grouped={true} />
        <AutostartToggle descriptionMode="inline" grouped={true} />
        <ShowOverlay descriptionMode="inline" grouped={true} />
        <UpdateChecksToggle descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Transcription Settings */}
      <SettingsGroup title={t("settings.general.groups.transcription")}>
        <LanguageSelector descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Voice Input/Output */}
      <SettingsGroup title={t("settings.general.groups.recording")}>
        <MicrophoneSelector descriptionMode="inline" grouped={true} />
        <PushToTalk descriptionMode="inline" grouped={true} />
        <AlwaysOnMicrophone descriptionMode="inline" grouped={true} />
        <MuteWhileRecording descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Text Input/Output */}
      <SettingsGroup title={t("settings.advanced.groups.inputOutput")}>
        <PasteMethodSetting descriptionMode="inline" grouped={true} />
        <ClipboardHandlingSetting descriptionMode="inline" grouped={true} />
        <AppendTrailingSpace descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Sound Settings */}
      <SettingsGroup title={t("settings.sound.title")}>
        <AudioFeedback descriptionMode="inline" grouped={true} />
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
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
