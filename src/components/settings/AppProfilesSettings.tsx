import { Box, Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../ui/SettingsGroup";
import { AppProfilesManager } from "./post-processing/AppReviewPolicies";

export const AppProfilesSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Box className="w-full max-w-5xl mx-auto">
      <Flex direction="column" gap="5">
        <SettingsGroup
          title={t(
            "settings.postProcessing.appRules.title",
            "Application Rules",
          )}
          description={t(
            "settings.postProcessing.appRules.description",
            "Set specific review behavior or custom prompts for different applications.",
          )}
        >
          <AppProfilesManager />
        </SettingsGroup>
      </Flex>
    </Box>
  );
};
