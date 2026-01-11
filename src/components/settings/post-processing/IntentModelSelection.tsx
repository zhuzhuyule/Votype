import { Text } from "@radix-ui/themes";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";

const DEFAULT_OPTION_VALUE = "__default__";

export const IntentModelSelection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, isUpdating } = useSettings();

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
      label: `${model.name} (${model.provider_id})`,
    })),
  ];

  const selectedValue =
    settings?.post_process_intent_model_id ?? DEFAULT_OPTION_VALUE;

  const handleSelect = (value: string) => {
    void updateSetting(
      "post_process_intent_model_id",
      value === DEFAULT_OPTION_VALUE ? null : value,
    );
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
        <Dropdown
          selectedValue={selectedValue}
          options={options}
          onSelect={handleSelect}
          placeholder={t("settings.postProcessing.intentModel.placeholder")}
          disabled={
            !settings?.post_process_enabled ||
            isUpdating("post_process_intent_model_id")
          }
          enableFilter={true}
        />
        {textModels.length === 0 && (
          <Text size="1" color="gray">
            {t("settings.postProcessing.models.empty.description")}
          </Text>
        )}
      </ActionWrapper>
    </SettingContainer>
  );
};

IntentModelSelection.displayName = "IntentModelSelection";
