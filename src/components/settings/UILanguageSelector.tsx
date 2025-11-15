import React, { useEffect, useMemo, useState } from "react";
import { Dropdown, DropdownOption } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useTranslation } from "react-i18next";
import i18n, { UI_LANGUAGE_STORAGE_KEY } from "../../i18n/config";

const UI_LANGUAGE_OPTIONS: DropdownOption[] = [
  { value: "system", label: "System default" },
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
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
    () =>
      UI_LANGUAGE_OPTIONS.map((option) => ({
        ...option,
        label:
          option.value === "system"
            ? t("uiLanguage.system")
            : option.value === "en"
            ? t("uiLanguage.english")
            : t("uiLanguage.chinese"),
      })),
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
