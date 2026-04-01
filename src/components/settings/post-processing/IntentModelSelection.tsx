import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui";
import { ModelChainSelector } from "../../ui/ModelChainSelector";
import { SettingContainer } from "../../ui/SettingContainer";

export const IntentModelSelection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateModelChain } = useSettings();

  return (
    <SettingContainer
      title={t("settings.postProcessing.intentModel.title")}
      description={t("settings.postProcessing.intentModel.description")}
      descriptionMode="tooltip"
      grouped={true}
      disabled={!settings?.post_process_enabled}
    >
      <ActionWrapper>
        <ModelChainSelector
          chain={settings?.post_process_intent_model ?? null}
          onChange={(chain) =>
            updateModelChain("post_process_intent_model", chain)
          }
          modelFilter={(m) => m.model_type === "text"}
          defaultStrategy="serial"
          disabled={!settings?.post_process_enabled}
          label={t("settings.postProcessing.intentModel")}
        />
      </ActionWrapper>
    </SettingContainer>
  );
};

IntentModelSelection.displayName = "IntentModelSelection";
