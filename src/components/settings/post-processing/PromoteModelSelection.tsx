import { Flex } from "@radix-ui/themes";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui";
import { Dropdown } from "../../ui/Dropdown";
import { ModelFallbackBadge } from "../../ui/ModelFallbackBadge";
import { SettingContainer } from "../../ui/SettingContainer";

export const PromoteModelSelection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateModelChain } = useSettings();

  const cachedModels = settings?.cached_models || [];
  const textModels = useMemo(
    () => cachedModels.filter((model) => model.model_type === "text"),
    [cachedModels],
  );

  const options = textModels.map((model) => ({
    value: model.id,
    label: model.custom_label
      ? `${model.custom_label} (${model.model_id})`
      : `${model.model_id} (${model.provider_id})`,
  }));

  const chain = settings?.selected_prompt_model ?? null;
  const selectedValue = chain?.primary_id ?? "";

  const handleSelect = (value: string) => {
    updateModelChain("selected_prompt_model", {
      primary_id: value,
      fallback_id: chain?.fallback_id ?? null,
      strategy: chain?.strategy ?? "staggered",
    });
  };

  if (textModels.length === 0) return null;

  return (
    <SettingContainer
      title={t("settings.postProcessing.api.model.title")}
      description={t("settings.postProcessing.api.model.descriptionDefault")}
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
            disabled={!settings?.post_process_enabled}
            enableFilter
          />
          <ModelFallbackBadge
            chain={chain}
            onChange={(c) => updateModelChain("selected_prompt_model", c)}
            modelFilter={(m) => m.model_type === "text"}
            disabled={!settings?.post_process_enabled || !chain?.primary_id}
          />
        </Flex>
      </ActionWrapper>
    </SettingContainer>
  );
};

PromoteModelSelection.displayName = "PromoteModelSelection";
