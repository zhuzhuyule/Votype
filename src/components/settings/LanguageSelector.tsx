import React, { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { SettingContainer } from "../ui/SettingContainer";
import { ResetButton } from "../ui/ResetButton";
import { Dropdown } from "../ui/Dropdown";
import { DropdownOption } from "../ui/Dropdown";
import { useSettings } from "../../hooks/useSettings";
import { useModels } from "../../hooks/useModels";
import { LANGUAGES } from "../../lib/constants/languages";

interface LanguageSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const unsupportedModels = ["parakeet-tdt-0.6b-v2", "parakeet-tdt-0.6b-v3"];

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { getSetting, updateSetting, resetSetting, isUpdating } = useSettings();
  const { currentModel, loadCurrentModel } = useModels();

  const selectedLanguage = getSetting("selected_language") || "auto";
  const isUnsupported = unsupportedModels.includes(currentModel);

  useEffect(() => {
    const modelStateUnlisten = listen("model-state-changed", () => {
      loadCurrentModel();
    });

    return () => {
      modelStateUnlisten.then((fn) => fn());
    };
  }, [loadCurrentModel]);

  const handleLanguageChange = async (value: string) => {
    await updateSetting("selected_language", value);
  };

  const handleReset = async () => {
    await resetSetting("selected_language");
  };

  // Convert LANGUAGES to DropdownOption format
  const languageOptions: DropdownOption[] = LANGUAGES.map(lang => ({
    value: lang.value,
    label: lang.label
  }));

  return (
    <SettingContainer
      title="Language"
      description={
        isUnsupported
          ? "Parakeet model automatically detects the language. No manual selection is needed."
          : "Select the language for speech recognition. Auto will automatically determine the language, while selecting a specific language can improve accuracy for that language."
      }
      descriptionMode={descriptionMode}
      grouped={grouped}
      disabled={isUnsupported}
    >
      <div className="flex items-center space-x-2">
        <div className="flex-1 min-w-[200px]">
          <Dropdown
            selectedValue={selectedLanguage}
            onSelect={handleLanguageChange}
            options={languageOptions}
            placeholder="Auto"
            disabled={isUnsupported || isUpdating("selected_language")}
          />
        </div>
        <ResetButton
          onClick={handleReset}
          disabled={isUpdating("selected_language") || isUnsupported}
        />
      </div>
    </SettingContainer>
  );
};
