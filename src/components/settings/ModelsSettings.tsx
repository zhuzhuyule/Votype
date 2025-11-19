import React from "react";
import { useTranslation } from "react-i18next";

import { SettingsGroup } from "../ui";
import { PostProcessingSettingsPrompts } from "./post-processing/PostProcessingSettings";
import { PromoteModelSelection } from "./post-processing/PromoteModelSelection";
import { PostProcessingToggle } from "./PostProcessingToggle";

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <>

      <SettingsGroup title={t("modelSettings.promptModelTitle")}>
        <PostProcessingToggle grouped={true} />
        <PromoteModelSelection />
        <PostProcessingSettingsPrompts />
      </SettingsGroup>
    </>
  );
};
