import { Flex } from "@radix-ui/themes";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui";
import { Dropdown } from "../../ui/Dropdown";
import { ModelFallbackBadge } from "../../ui/ModelFallbackBadge";
import { SettingContainer } from "../../ui/SettingContainer";

const DEFAULT_OPTION_VALUE = "__default__";

export const IntentModelSelection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateModelChain } = useSettings();

  const cachedModels = settings?.cached_models || [];
  const textModels = useMemo(
    () => cachedModels.filter((model) => model.model_type === "text"),
    [cachedModels],
  );

  const options = [
    {
      value: DEFAULT_OPTION_VALUE,
      label: t("settings.postProcessing.intentModel.defaultOption"),
    },
    ...textModels.map((model) => ({
      value: model.id,
      label: model.custom_label
        ? `${model.custom_label} (${model.model_id})`
        : `${model.model_id} (${model.provider_id})`,
    })),
  ];

  const chain = settings?.post_process_intent_model ?? null;
  const selectedValue = chain?.primary_id ?? DEFAULT_OPTION_VALUE;

  const handleSelect = (value: string) => {
    if (value === DEFAULT_OPTION_VALUE) {
      updateModelChain("post_process_intent_model", null);
    } else {
      updateModelChain("post_process_intent_model", {
        primary_id: value,
        fallback_id: chain?.fallback_id ?? null,
        strategy: chain?.strategy ?? "serial",
      });
    }
  };

  return (
    <SettingContainer
      title={t("settings.postProcessing.intentModel.title")}
      description={t("settings.postProcessing.intentModel.description")}
      descriptionMode="tooltip"
      grouped={true}
      disabled={!settings?.post_process_enabled}
    >
      <ActionWrapper>
        <Flex align="center" gap="2">
          <Dropdown
            selectedValue={selectedValue}
            options={options}
            onSelect={handleSelect}
            placeholder={t("settings.postProcessing.intentModel.placeholder")}
            disabled={!settings?.post_process_enabled}
            enableFilter
          />
          <ModelFallbackBadge
            chain={chain}
            onChange={(c) => updateModelChain("post_process_intent_model", c)}
            modelFilter={(m) => m.model_type === "text"}
            disabled={!settings?.post_process_enabled || !chain?.primary_id}
          />
        </Flex>
      </ActionWrapper>
    </SettingContainer>
  );
};

IntentModelSelection.displayName = "IntentModelSelection";
