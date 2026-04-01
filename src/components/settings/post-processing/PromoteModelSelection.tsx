import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui";
import { ModelChainSelector } from "../../ui/ModelChainSelector";
import { SettingContainer } from "../../ui/SettingContainer";

export const PromoteModelSelection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateModelChain } = useSettings();

  return (
    <SettingContainer
      title={t("settings.postProcessing.api.model.title")}
      description={t("settings.postProcessing.api.model.descriptionDefault")}
      descriptionMode="tooltip"
      grouped={true}
      disabled={!settings?.post_process_enabled}
    >
      <ActionWrapper>
        <ModelChainSelector
          chain={settings?.selected_prompt_model ?? null}
          onChange={(chain) => updateModelChain("selected_prompt_model", chain)}
          modelFilter={(m) => m.model_type === "text"}
          defaultStrategy="staggered"
          disabled={!settings?.post_process_enabled}
        />
      </ActionWrapper>
    </SettingContainer>
  );
};

PromoteModelSelection.displayName = "PromoteModelSelection";
