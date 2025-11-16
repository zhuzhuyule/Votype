import React, { useMemo } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { SettingContainer } from "../../ui/SettingContainer";
import { Dropdown } from "../../ui/Dropdown";
import { useSettings } from "../../../hooks/useSettings";
import { useTranslation } from "react-i18next";

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
      title={t("promptModel.title")}
      description={t("promptModel.description")}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <Flex direction="column" gap="2">
        <Dropdown
          selectedValue={selectedModelId}
          options={options}
          onSelect={handleSelect}
          placeholder={
            options.length === 0
              ? t("promptModel.placeholderAddModel")
              : t("promptModel.placeholderSelectModel")
          }
          disabled={
            options.length === 0 ||
            isUpdating("select_post_process_model")
          }
        />
        {options.length === 0 && (
          <Text size="1" color="gray">
            {t("promptModel.hintAddModel")}
          </Text>
        )}
      </Flex>
    </SettingContainer>
  );
};

PromoteModelSelection.displayName = "PromoteModelSelection";
