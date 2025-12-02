import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enCommon from "../locales/en/common.json";
import zhCommon from "../locales/zh/common.json";

export const UI_LANGUAGE_STORAGE_KEY = "votype-ui-language";

const resources = {
  en: {
    common: enCommon,
  },
  zh: {
    common: zhCommon,
  },
};

const detectionOptions = {
  order: ["localStorage", "navigator"],
  caches: ["localStorage"],
  lookupLocalStorage: UI_LANGUAGE_STORAGE_KEY,
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    ns: ["common"],
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
    },
    detection: detectionOptions,
    react: {
      useSuspense: false,
    },
  });

export default i18n;
