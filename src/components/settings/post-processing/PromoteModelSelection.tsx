import { Text } from "@radix-ui/themes";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";

export const PromoteModelSelection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, selectPromptModel, isUpdating } = useSettings();

  const cachedModels = settings?.cached_models || [];
  const textModels = useMemo(
    () => cachedModels.filter((model) => model.model_type === "text"),
    [cachedModels],
  );

  const options = textModels.map((model) => ({
    value: model.id,
    label: `${model.name} (${model.provider_id})`,
  }));

  const selectedModelId = settings?.selected_prompt_model_id ?? undefined;

  const handleSelect = (value: string) => {
    void selectPromptModel(value);
  };

  return (
    <SettingContainer
      title={t("settings.postProcessing.api.model.title")}
      description={t("settings.postProcessing.api.model.descriptionDefault")}
      descriptionMode="tooltip"
      grouped={true}
      disabled={!settings?.post_process_enabled}
    >
      <ActionWrapper>
        <Dropdown
          selectedValue={selectedModelId}
          options={options}
          onSelect={handleSelect}
          placeholder={
            options.length === 0
              ? t("settings.postProcessing.api.model.placeholderNoOptions")
              : t("settings.postProcessing.api.model.placeholderWithOptions")
          }
          disabled={
            !settings?.post_process_enabled ||
            options.length === 0 ||
            isUpdating("select_post_process_model")
          }
        />
        {options.length === 0 && (
          <Text size="1" color="gray">
            {t("settings.postProcessing.models.empty.description")}
          </Text>
        )}
      </ActionWrapper>
    </SettingContainer>
  );
};

PromoteModelSelection.displayName = "PromoteModelSelection";
