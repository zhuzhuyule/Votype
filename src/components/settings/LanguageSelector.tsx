import React, { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { SettingContainer } from "../ui/SettingContainer";
import { Dropdown } from "../ui/Dropdown";
import { DropdownOption } from "../ui/Dropdown";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { useModels } from "../../hooks/useModels";
import { LANGUAGES } from "../../lib/constants/languages";
import { ActionWrapper } from "../ui";

interface LanguageSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const unsupportedModels = ["parakeet-tdt-0.6b-v2", "parakeet-tdt-0.6b-v3"];

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
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
  const languageOptions: DropdownOption[] = LANGUAGES.map((lang) => ({
    value: lang.value,
    label: lang.label,
  }));

  return (
    <SettingContainer
      title={t("settings.general.language.title")}
      description={
        isUnsupported
          ? t("settings.general.language.descriptionUnsupported")
          : t("settings.general.language.description")
      }
      descriptionMode={descriptionMode}
      grouped={grouped}
      disabled={isUnsupported}
    >
      <ActionWrapper
        onReset={handleReset}
        resetProps={{
          disabled: isUpdating("selected_language") || isUnsupported,
        }}
      >
        <Dropdown
          selectedValue={selectedLanguage}
          onSelect={handleLanguageChange}
          options={languageOptions}
          placeholder={t("settings.general.language.searchPlaceholder")}
          disabled={isUnsupported || isUpdating("selected_language")}
        />
      </ActionWrapper>
    </SettingContainer>
  );
};
