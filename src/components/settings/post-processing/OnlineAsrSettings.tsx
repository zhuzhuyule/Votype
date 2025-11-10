import React, { useMemo } from "react";

import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SettingContainer } from "../../ui/SettingContainer";
import { Select } from "../../ui/Select";
import { useSettings } from "../../../hooks/useSettings";

export const OnlineAsrSettings: React.FC = () => {
  const {
    settings,
    toggleOnlineAsr,
    selectAsrModel,
    isUpdating,
  } = useSettings();

  const enabled = settings?.online_asr_enabled || false;
  const cachedModels = settings?.cached_models || [];
  const asrModels = useMemo(
    () => cachedModels.filter((model) => model.model_type === "asr"),
    [cachedModels],
  );

  const asrOptions = asrModels.map((model) => ({
    value: model.id,
    label: `${model.name} (${model.provider_id})`,
  }));

  const selectedModelId = settings?.selected_asr_model_id || null;

  const handleToggle = (checked: boolean) => {
    void toggleOnlineAsr(checked);
  };

  const handleModelSelect = (value: string | null) => {
    void selectAsrModel(value);
  };

  return (
    <div className="space-y-4">
      <ToggleSwitch
        checked={enabled}
        onChange={handleToggle}
        label="使用在线 ASR"
        description="启用后转录将通过已配置的 ASR 模型，其它情况仍使用本地 Whisper。"
        descriptionMode="tooltip"
        grouped={true}
        isUpdating={isUpdating("toggle_online_asr")}
      />

      <SettingContainer
        title="在线转录模型"
        description="从已添加的 ASR 模型中选择一个用于实时转录。"
        descriptionMode="tooltip"
        layout="stacked"
        grouped={true}
      >
        <div className="space-y-2">
          <Select
            value={selectedModelId}
            options={asrOptions}
            onChange={(value) => handleModelSelect(value)}
            onBlur={() => {}}
            placeholder={
              asrOptions.length === 0
                ? "请先添加 ASR 类型模型"
                : "选择在线 ASR 模型"
            }
            disabled={!enabled || asrOptions.length === 0}
            isClearable
          />
          {!enabled && (
            <p className="text-xs text-mid-gray/70">
              打开“使用在线 ASR”开关以启用模型选择。
            </p>
          )}
          {enabled && asrOptions.length === 0 && (
            <p className="text-xs text-mid-gray/70">
              没有可用的 ASR 模型，请先在模型配置中添加。
            </p>
          )}
        </div>
      </SettingContainer>
    </div>
  );
};

OnlineAsrSettings.displayName = "OnlineAsrSettings";
