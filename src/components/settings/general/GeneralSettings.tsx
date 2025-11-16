import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AudioFeedback } from "../AudioFeedback";
import { HandyShortcut } from "../HandyShortcut";
import { LanguageSelector } from "../LanguageSelector";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PushToTalk } from "../PushToTalk";
import { UILanguageSelector } from "../UILanguageSelector";
import { VolumeSlider } from "../VolumeSlider";
import { ThemeSettings } from "./ThemeSettings";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  return (
    <Flex direction="column" className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.groups.general")}>
        <HandyShortcut descriptionMode="tooltip" grouped={true} />
        <LanguageSelector descriptionMode="tooltip" grouped={true} />
        <UILanguageSelector />
        <PushToTalk descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
      <SettingsGroup title={t("settings.groups.sound")}>
        <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <AudioFeedback descriptionMode="tooltip" grouped={true} />
        <OutputDeviceSelector
          descriptionMode="tooltip"
          grouped={true}
          disabled={!audioFeedbackEnabled}
        />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsGroup>
      <ThemeSettings />
    </Flex>
  );
};
