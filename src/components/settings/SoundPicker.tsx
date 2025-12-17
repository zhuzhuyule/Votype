import { IconButton } from "@radix-ui/themes";
import { IconPlayerPlay } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { useSettingsStore } from "../../stores/settingsStore";
import { ActionWrapper } from "../ui/ActionWrapper";
import { Dropdown, DropdownOption } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

interface SoundPickerProps {
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
}

export const SoundPicker: React.FC<SoundPickerProps> = ({
  label,
  description,
  descriptionMode = "inline",
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const playTestSound = useSettingsStore((state) => state.playTestSound);
  const customSounds = useSettingsStore((state) => state.customSounds);

  const selectedTheme = getSetting("sound_theme") ?? "marimba";

  const options: DropdownOption[] = [
    { value: "marimba", label: t("soundPicker.marimba") },
    { value: "pop", label: t("soundPicker.pop") },
  ];

  // Only add Custom option if both custom sound files exist
  if (customSounds.start && customSounds.stop) {
    options.push({ value: "custom", label: t("soundPicker.custom") });
  }

  const handlePlayBothSounds = async () => {
    await playTestSound("start");
    await playTestSound("stop");
  };

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped
      layout="horizontal"
    >
      <ActionWrapper>
        <Dropdown
          selectedValue={selectedTheme}
          onSelect={(value) =>
            updateSetting("sound_theme", value as "marimba" | "pop" | "custom")
          }
          options={options}
        />
        <IconButton
          variant="ghost"
          onClick={handlePlayBothSounds}
          title={t("soundPicker.preview")}
        >
          <IconPlayerPlay size="18" />
        </IconButton>
      </ActionWrapper>
    </SettingContainer>
  );
};
