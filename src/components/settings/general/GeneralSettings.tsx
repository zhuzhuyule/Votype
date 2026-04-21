import { Flex, Select, Text } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { AudioInputAutoEnhance } from "../AudioInputAutoEnhance";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { AudioFeedback } from "../AudioFeedback";
import { AutostartToggle } from "../AutostartToggle";
import { ClipboardHandlingSetting } from "../ClipboardHandling";
import { LanguageSelector } from "../LanguageSelector";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PasteMethodSetting } from "../PasteMethod";
import { ActivationMode } from "../PushToTalk";
import { ShowOverlay } from "../ShowOverlay";
import { SoundPicker } from "../SoundPicker";
import { StartHidden } from "../StartHidden";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { VolumeSlider } from "../VolumeSlider";
import { FONT_FAMILY_LABELS, FONT_FAMILY_MAP } from "../../../lib/theme";
import { useTheme } from "../../theme/RadixThemeProvider";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, expertMode } = useSettings();
  const { fontFamily, setFontFamily } = useTheme();
  const previewText =
    "The quick brown fox jumps over the lazy dog — 语音转写 Votype 0123";

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      {/* Starting Up */}
      <SettingsGroup title={t("settings.advanced.groups.startup")}>
        <AutostartToggle descriptionMode="inline" grouped={true} />
        <ShowOverlay descriptionMode="inline" grouped={true} />
        {/* Expert only */}
        {expertMode && (
          <>
            <StartHidden descriptionMode="inline" grouped={true} />
            <UpdateChecksToggle descriptionMode="inline" grouped={true} />
          </>
        )}
      </SettingsGroup>

      {/* Transcription Settings */}
      <SettingsGroup title={t("settings.general.groups.transcription")}>
        <LanguageSelector descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Voice Input/Output */}
      <SettingsGroup title={t("settings.general.groups.recording")}>
        <MicrophoneSelector descriptionMode="inline" grouped={true} />
        <AudioInputAutoEnhance descriptionMode="inline" grouped={true} />
        <ActivationMode descriptionMode="inline" grouped={true} />
        {/* Expert only */}
        {expertMode && (
          <>
            <AlwaysOnMicrophone descriptionMode="inline" grouped={true} />
            <MuteWhileRecording descriptionMode="inline" grouped={true} />
          </>
        )}
      </SettingsGroup>

      {/* Text Input/Output */}
      <SettingsGroup title={t("settings.advanced.groups.inputOutput")}>
        <PasteMethodSetting descriptionMode="inline" grouped={true} />
        <ClipboardHandlingSetting descriptionMode="inline" grouped={true} />
        <AppendTrailingSpace descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      {/* Font Settings */}
      <SettingsGroup title="字体">
        <SettingContainer
          title="界面字体"
          description="切换后可立刻预览效果，选出最顺眼的后可作为默认字体。"
          layout="stacked"
          descriptionMode="inline"
        >
          <Flex direction="column" gap="3" className="w-full">
            <Select.Root
              value={fontFamily}
              onValueChange={(value) => setFontFamily(value)}
            >
              <Select.Trigger className="w-fit min-w-[260px]" />
              <Select.Content>
                {Object.keys(FONT_FAMILY_MAP).map((key) => (
                  <Select.Item key={key} value={key}>
                    <span
                      style={{ fontFamily: FONT_FAMILY_MAP[key] }}
                      className="inline-block"
                    >
                      {FONT_FAMILY_LABELS[key] ?? key}
                    </span>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>

            <Flex direction="column" gap="2">
              <Text size="1" color="gray">
                当前字体预览
              </Text>
              <div
                className="rounded-md border border-gray-a5 bg-gray-a2 p-3"
                style={{
                  fontFamily:
                    FONT_FAMILY_MAP[fontFamily] ?? FONT_FAMILY_MAP.default,
                }}
              >
                <div style={{ fontSize: 16, lineHeight: 1.6 }}>
                  {previewText}
                </div>
                <div
                  style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.8 }}
                  className="mt-1"
                >
                  敏捷的棕色狐狸跳过了那只懒狗。Votype 让语音输入更顺滑。
                </div>
              </div>
            </Flex>
          </Flex>
        </SettingContainer>
      </SettingsGroup>
    </Flex>
  );
};

export default GeneralSettings;
