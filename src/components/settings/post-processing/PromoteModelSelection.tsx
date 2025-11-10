import React, { useMemo } from "react";

import { SettingContainer } from "../../ui/SettingContainer";
import { Dropdown } from "../../ui/Dropdown";
import { useSettings } from "../../../hooks/useSettings";

export const PromoteModelSelection: React.FC = () => {
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

  const selectedModelId = settings?.selected_prompt_model_id || null;

  const handleSelect = (value: string | null) => {
    void selectPromptModel(value);
  };

  return (
    <SettingContainer
      title="Promote 模型"
      description="选择一个文本模型用于 Post-processing 提示。"
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="space-y-2">
        <Dropdown
          selectedValue={selectedModelId}
          options={options}
          onSelect={handleSelect}
          placeholder={
            options.length === 0
              ? "请先添加 Text 类型模型"
              : "选择用作 Prompt 的模型"
          }
          disabled={
            options.length === 0 ||
            isUpdating("select_post_process_model")
          }
        />
        {options.length === 0 && (
          <p className="text-xs text-mid-gray/70">
            需要在「AI」设置中添加一个 Text 类型模型。
          </p>
        )}
      </div>
    </SettingContainer>
  );
};

PromoteModelSelection.displayName = "PromoteModelSelection";
