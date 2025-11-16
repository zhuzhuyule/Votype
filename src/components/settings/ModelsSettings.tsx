import React from "react";
import { useTranslation } from "react-i18next";
import { Flex } from "@radix-ui/themes";

import { PromoteModelSelection } from "./post-processing/PromoteModelSelection";
import { OnlineAsrSettings } from "./post-processing/OnlineAsrSettings";
import { PostProcessingSettingsPrompts } from "./post-processing/PostProcessingSettings";
import { SettingsGroup } from "../ui";
import { PostProcessingToggle } from "./PostProcessingToggle";

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  
  return (
    <Flex direction="column" className="max-w-3xl w-full mx-auto p-6 shadow-sm space-y-8">
      <SettingsGroup title={t("modelSettings.title")}>
        <OnlineAsrSettings />
      </SettingsGroup>
      <SettingsGroup title={t("modelSettings.promptModelTitle")}>
        <PostProcessingToggle grouped={true}  />
        <Flex direction="column" gap="4">
          <PromoteModelSelection />
          <PostProcessingSettingsPrompts />
        </Flex>
      </SettingsGroup>
    </Flex>
  );
};
