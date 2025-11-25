import { Button, Flex, Text } from "@radix-ui/themes";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { VotypeHand } from "../../icons/VotypeHand";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
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
    <Flex direction="column" className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("about.title")}>
        <div className="flex flex-col items-center gap-4 mb-8">
          <VotypeHand size={36} />
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {t('common.versions')} {version}
            </p>
          </div>
        </div>

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
          <Text size="2" color="gray">
            {t("about.whisper.content")}
          </Text>
        </SettingContainer>
      </SettingsGroup>
    </Flex>
  );
};
