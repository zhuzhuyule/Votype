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
      title={t("debugPaths.title")}
      description={t("debugPaths.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <ActionWrapper>
        <Flex direction="column" gap="2" className="text-sm text-gray-600">
          <Flex>
            <Text weight="medium">{t("debugPaths.appData")}:</Text>{" "}
            <Text className="font-mono text-xs">%APPDATA%/handy</Text>
          </Flex>
          <Flex>
            <Text weight="medium">{t("debugPaths.models")}:</Text>{" "}
            <Text className="font-mono text-xs">%APPDATA%/handy/models</Text>
          </Flex>
          <Flex>
            <Text weight="medium">{t("debugPaths.settings")}:</Text>{" "}
            <Text className="font-mono text-xs">
              %APPDATA%/handy/settings_store.json
            </Text>
          </Flex>
        </Flex>
      </ActionWrapper>
    </SettingContainer>
  );
};
