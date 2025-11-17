import { Flex, Text } from "@radix-ui/themes";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ActionWrapper } from "../../ui/ActionWrapper";
import { Select } from "../../ui/Select";
import { SettingContainer } from "../../ui/SettingContainer";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

export const OnlineAsrSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, toggleOnlineAsr, selectAsrModel, isUpdating } =
    useSettings();

  const enabled = settings?.online_asr_enabled || false;
  const cachedModels = settings?.cached_models || [];
  const asrModels = useMemo(
    () => cachedModels.filter((model) => model.model_type === "asr"),
    [cachedModels],
  );

  const providerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers.forEach((provider) => {
      map[provider.id] = provider.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const asrOptions = asrModels.map((model) => ({
    value: model.id,
    label: `${model.name} (${
      providerNameMap[model.provider_id] ?? model.provider_id
    })`,
  }));

  const selectedModelId = settings?.selected_asr_model_id || null;

  const handleToggle = (checked: boolean) => {
    void toggleOnlineAsr(checked);
  };

  const handleModelSelect = (value: string | null) => {
    void selectAsrModel(value);
  };

  return (
    <Flex direction="column" gap="4">
      <ToggleSwitch
        checked={enabled}
        onChange={handleToggle}
        label={t("onlineAsr.title")}
        description={t("onlineAsr.description")}
        descriptionMode="tooltip"
        grouped={true}
        isUpdating={isUpdating("toggle_online_asr")}
      />

      <SettingContainer
        title={t("onlineAsr.modelTitle")}
        description={t("onlineAsr.modelDescription")}
        descriptionMode="tooltip"
        layout="stacked"
        grouped={true}
      >
        <ActionWrapper>
          <Flex direction="column" gap="2">
            <Select
              value={selectedModelId}
              options={asrOptions}
              onChange={(value) => handleModelSelect(value)}
              onBlur={() => {}}
              placeholder={
                asrOptions.length === 0
                  ? t("onlineAsr.placeholderAddModel")
                  : t("onlineAsr.placeholderSelectModel")
              }
              disabled={!enabled || asrOptions.length === 0}
              isClearable
            />
            {!enabled && (
              <Text size="1" color="gray">
                {t("onlineAsr.hintEnableToggle")}
              </Text>
            )}
            {enabled && asrOptions.length === 0 && (
              <Text size="1" color="gray">
                {t("onlineAsr.hintNoModel")}
              </Text>
            )}
          </Flex>
        </ActionWrapper>
      </SettingContainer>
    </Flex>
  );
};

OnlineAsrSettings.displayName = "OnlineAsrSettings";
