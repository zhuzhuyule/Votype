import { Flex, Text } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { ActionWrapper } from "../../ui/ActionWrapper";
import { SettingContainer } from "../../ui/SettingContainer";

interface DebugPathsProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const DebugPaths: React.FC<DebugPathsProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();

  return (
    <SettingContainer
      title={t("settings.debug.paths.title")}
      description={t("settings.debug.paths.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <ActionWrapper>
        <Flex direction="column" gap="2" className="text-sm text-gray-600">
          <Flex>
            <Text weight="medium">{t("settings.debug.paths.appData")}:</Text>{" "}
            <Text className="font-mono text-xs">%APPDATA%/votype</Text>
          </Flex>
          <Flex>
            <Text weight="medium">{t("settings.debug.paths.models")}:</Text>{" "}
            <Text className="font-mono text-xs">%APPDATA%/votype/models</Text>
          </Flex>
          <Flex>
            <Text weight="medium">{t("settings.debug.paths.settings")}:</Text>{" "}
            <Text className="font-mono text-xs">
              %APPDATA%/votype/settings_store.json
            </Text>
          </Flex>
        </Flex>
      </ActionWrapper>
    </SettingContainer>
  );
};
