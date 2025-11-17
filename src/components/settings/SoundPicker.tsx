import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, DropdownOption } from "../ui/Dropdown";
import { PlayIcon } from "lucide-react";
import { SettingContainer } from "../ui/SettingContainer";
import { ActionWrapper } from "../ui/ActionWrapper";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSettings } from "../../hooks/useSettings";
import { IconButton } from "@radix-ui/themes";

interface SoundPickerProps {
  label: string;
  description: string;
}

export const SoundPicker: React.FC<SoundPickerProps> = ({
  label,
  description,
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
    // Wait before playing stop sound
    await new Promise((resolve) => setTimeout(resolve, 800));
    await playTestSound("stop");
  };

  return (
    <SettingContainer
      title={label}
      description={description}
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
          <PlayIcon size="18" />
        </IconButton>
      </ActionWrapper>
    </SettingContainer>
  );
};
