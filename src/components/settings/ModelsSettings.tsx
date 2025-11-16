import React from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../hooks/useSettings";
import { SettingsGroup } from "../ui";
import { ActionWrapper } from "../ui/ActionWraperr";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { PostProcessingSettingsPrompts } from "./post-processing/PostProcessingSettings";
import { PromoteModelSelection } from "./post-processing/PromoteModelSelection";
import { PostProcessingToggle } from "./PostProcessingToggle";

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, toggleOnlineAsr, selectAsrModel, isUpdating } =
    useSettings();

  const enabled = settings?.online_asr_enabled || false;
  const cachedModels = settings?.cached_models || [];
  const asrModels = React.useMemo(
    () => cachedModels.filter((model) => model.model_type === "asr"),
    [cachedModels],
  );

  const providerNameMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers.forEach((provider) => {
      map[provider.id] = provider.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const asrOptions = React.useMemo(
    () =>
      asrModels.map((model) => ({
        value: model.id,
        label: `${model.name} (${
          providerNameMap[model.provider_id] ?? model.provider_id
        })`,
      })),
    [asrModels, providerNameMap],
  );

  const selectedModelId = settings?.selected_asr_model_id || null;

  const handleToggle = (checked: boolean) => {
    void toggleOnlineAsr(checked);
  };

  const handleModelSelect = (value: string) => {
    void selectAsrModel(value);
  };

  return (
    <>
      <SettingsGroup title={t("modelSettings.title")}>
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
          disabled={!enabled || asrOptions.length === 0}
        >
          <ActionWrapper>
            <Dropdown
              options={asrOptions}
              selectedValue={selectedModelId || undefined}
              onSelect={(value) => handleModelSelect(value)}
              placeholder={
                asrOptions.length === 0
                  ? t("onlineAsr.placeholderAddModel")
                  : t("onlineAsr.placeholderSelectModel")
              }
              disabled={!enabled || asrOptions.length === 0}
              className="w-full"
            />
          </ActionWrapper>
        </SettingContainer>
      </SettingsGroup>
      <SettingsGroup title={t("modelSettings.promptModelTitle")}>
        <PostProcessingToggle grouped={true} />
        <PromoteModelSelection />
        <PostProcessingSettingsPrompts />
      </SettingsGroup>
    </>
  );
};
