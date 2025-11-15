import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "@radix-ui/themes";
import { AppDataDirectory } from "../AppDataDirectory";

export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("0.1.2");
      }
    };

    fetchVersion();
  }, []);

  const handleDonateClick = async () => {
    try {
      await openUrl("https://handy.computer/donate");
    } catch (error) {
      console.error("Failed to open donate link:", error);
    }
  };

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("about.title")}>
        <SettingContainer
          title={t("about.version.title")}
          description={t("about.version.description")}
          grouped={true}
        >
          <span className="text-sm font-mono">v{version}</span>
        </SettingContainer>

        <AppDataDirectory descriptionMode="tooltip" grouped={true} />

        <SettingContainer
          title={t("about.sourceCode.title")}
          description={t("about.sourceCode.description")}
          grouped={true}
        >
          <Button
            variant="outline"
            size="2"
            onClick={() => openUrl("https://github.com/cjpais/Handy")}
          >
            {t("about.sourceCode.viewOnGitHub")}
          </Button>
        </SettingContainer>

        <SettingContainer
          title={t("about.support.title")}
          description={t("about.support.description")}
          grouped={true}
        >
          <Button
            variant="solid"
            size="2"
            color="pink"
            onClick={handleDonateClick}
          >
            {t("about.support.donate")}
          </Button>
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title={t("about.acknowledgments")}>
        <SettingContainer
          title={t("about.whisper.title")}
          description={t("about.whisper.description")}
          grouped={true}
          layout="stacked"
        >
          <div className="text-sm text-mid-gray">
            {t("about.whisper.content")}
          </div>
        </SettingContainer>
      </SettingsGroup>
    </div>
  );
};
