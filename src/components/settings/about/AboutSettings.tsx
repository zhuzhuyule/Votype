import { Button, Flex, Text } from "@radix-ui/themes";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { VotypeHand } from "../../icons/VotypeHand";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AppDataDirectory } from "../AppDataDirectory";
import { RecordingsDirectory } from "../RecordingsDirectory";

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
      await openUrl("https://votype.com/donate");
    } catch (error) {
      console.error("Failed to open donate link:", error);
    }
  };

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      <SettingsGroup title={t("settings.about.title")}>
        <Flex direction="column" align="center" gap="4" py="4">
          <VotypeHand size={48} />
          <div className="text-center">
            <Text size="5" weight="bold">
              Votype
            </Text>
            <p className="text-sm text-gray-500 mt-1">
              {t("settings.about.version.title")}: {version}
            </p>
          </div>
        </Flex>

        <AppDataDirectory descriptionMode="inline" grouped={true} />
        <RecordingsDirectory descriptionMode="inline" grouped={true} />

        <SettingContainer
          title={t("settings.about.sourceCode.title")}
          description={t("settings.about.sourceCode.description")}
          grouped={true}
          descriptionMode="inline"
        >
          <Button
            variant="outline"
            size="2"
            onClick={() => openUrl("https://github.com/zhuzhuyule/Votype")}
          >
            {t("settings.about.sourceCode.button")}
          </Button>
        </SettingContainer>

        <SettingContainer
          title={t("settings.about.supportDevelopment.title")}
          description={t("settings.about.supportDevelopment.description")}
          grouped={true}
          descriptionMode="inline"
        >
          <Button variant="solid" size="2" onClick={handleDonateClick}>
            {t("settings.about.supportDevelopment.button")}
          </Button>
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title={t("settings.about.acknowledgments.title")}>
        <SettingContainer
          title={t("settings.about.acknowledgments.whisper.title")}
          description={t("settings.about.acknowledgments.whisper.description")}
          grouped={true}
          layout="stacked"
          descriptionMode="inline"
        >
          <Text size="2" color="gray">
            {t("settings.about.acknowledgments.whisper.details")}
          </Text>
        </SettingContainer>
      </SettingsGroup>
    </Flex>
  );
};
