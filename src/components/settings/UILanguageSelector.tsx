import React, { useEffect, useMemo, useState } from "react";
import { Dropdown, DropdownOption } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useTranslation } from "react-i18next";
import i18n, { UI_LANGUAGE_STORAGE_KEY } from "../../i18n/config";

const getUI_LANGUAGE_OPTIONS = (t: (key: string) => string): DropdownOption[] => [
  { value: "system", label: t("uiLanguage.system") },
  { value: "en", label: t("uiLanguage.english") },
  { value: "zh", label: t("uiLanguage.chinese") },
];

const detectPreferredLanguage = () => {
  if (typeof window === "undefined") {
    return "en";
  }
  const navLang = navigator.language || "en";
  const normalized = navLang.split("-")[0].toLowerCase();
  return normalized === "zh" ? "zh" : "en";
};

export const UILanguageSelector: React.FC = () => {
  const { t } = useTranslation();
  const [selectedValue, setSelectedValue] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "system";
    }
    const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return stored ?? "system";
  });

  const options = useMemo(
    () => getUI_LANGUAGE_OPTIONS(t),
    [t],
  );

  const handleChange = (value: string) => {
    if (value === "system") {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(UI_LANGUAGE_STORAGE_KEY);
      }
      const preferred = detectPreferredLanguage();
      i18n.changeLanguage(preferred);
    } else {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, value);
      }
      i18n.changeLanguage(value);
    }
    setSelectedValue(value);
  };

  useEffect(() => {
    const handler = (lng: string) => {
      if (typeof window === "undefined") {
        return;
      }
      setSelectedValue(
        window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY) ?? "system",
      );
    };
    i18n.on("languageChanged", handler);
    return () => {
      i18n.off("languageChanged", handler);
    };
  }, []);

  return (
    <SettingContainer
      title={t("uiLanguage.title")}
      description={t("uiLanguage.description")}
      descriptionMode="tooltip"
      grouped
    >
      <Dropdown
        selectedValue={selectedValue}
        onSelect={handleChange}
        options={options}
        placeholder={t("uiLanguage.placeholder")}
      />
    </SettingContainer>
  );
};
