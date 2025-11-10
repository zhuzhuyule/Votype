import React, { useMemo, useState, useCallback, useEffect } from "react";

import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { SettingContainer } from "../../ui/SettingContainer";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { useSettings } from "../../../hooks/useSettings";
import type { ModelType, CachedModel } from "../../../lib/types";

const modelTypeOptions = [
  { value: "text", label: "Text" },
  { value: "asr", label: "ASR" },
  { value: "other", label: "Other" },
] as const;

const buildCacheId = (modelId: string, providerId: string) => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${providerId}-${modelId}-${Date.now()}`;
};

export const ModelConfigurationPanel: React.FC = () => {
  const state = usePostProcessProviderState();
  const {
    settings,
    addCachedModel,
    updateCachedModelType,
    removeCachedModel,
    isUpdating,
  } = useSettings();

  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [pendingModelType, setPendingModelType] = useState<ModelType>("text");
  const [customTypeLabel, setCustomTypeLabel] = useState("");

  const cachedModels = settings?.cached_models ?? [];
  const providerId = state.selectedProviderId;

  const configuredIds = useMemo(() => {
    return new Set(cachedModels.map((model) => model.model_id));
  }, [cachedModels]);

  const availableModels = useMemo(() => {
    return state.modelOptions.filter(
      (option) => option.value && !configuredIds.has(option.value),
    );
  }, [state.modelOptions, configuredIds]);

  useEffect(() => {
    if (availableModels.length === 0) {
      setPendingModelId(null);
      return;
    }
    setPendingModelId((current) =>
      current && availableModels.some((option) => option.value === current)
        ? current
        : availableModels[0].value,
    );
  }, [availableModels]);

  const handleAddModel = useCallback(
    async (modelId: string, modelType: ModelType) => {
      if (!providerId) return;
      const newModel: CachedModel = {
        id: buildCacheId(modelId, providerId),
        name: modelId,
        model_type: modelType,
        provider_id: providerId,
        model_id: modelId,
        added_at: new Date().toISOString(),
      };
      await addCachedModel(newModel);
    },
    [addCachedModel, providerId],
  );

  const handleTypeUpdate = useCallback(
    async (modelId: string, modelType: ModelType) => {
      await updateCachedModelType(modelId, modelType);
    },
    [updateCachedModelType],
  );

  const handleRemoveModel = useCallback(
    async (modelId: string) => {
      await removeCachedModel(modelId);
    },
    [removeCachedModel],
  );

  return (
    <SettingContainer
      title="模型配置"
      description="从已配置的Provider获取模型，添加后手动指定其用途（文本 / ASR / 其他）。"
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="space-y-4 relative">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setIsModelPickerOpen(true)}
            variant="secondary"
            size="md"
          >
            添加模型
          </Button>
          <Button
            onClick={state.handleRefreshModels}
            variant="ghost"
            size="sm"
            disabled={state.isFetchingModels}
          >
            {state.isFetchingModels ? "刷新中..." : "刷新模型列表"}
          </Button>
        </div>

        {isModelPickerOpen && (
          <div className="absolute right-0 top-full z-30 mt-2 w-[320px] rounded-lg border border-mid-gray/20 bg-white p-4 shadow-lg">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-text">选择模型</p>
                <p className="text-xs text-mid-gray/70">
                  从当前 Provider 返回的模型中选择要缓存的条目，然后设定用途。
                </p>
              </div>
              <div className="flex justify-between gap-2">
                <div></div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={state.handleRefreshModels}
                  disabled={state.isFetchingModels}
                >
                  刷新
                </Button>
              </div>
              <Select
                value={pendingModelId}
                options={availableModels}
                onChange={(value) => setPendingModelId(value)}
                onCreateOption={(inputValue) => setPendingModelId(inputValue.trim())}
                isCreatable
                formatCreateLabel={(input) => `Use "${input}"`}
                onBlur={() => {}}
                placeholder={
                  availableModels.length === 0
                    ? "暂无可添加的模型"
                    : "选择或输入模型名称"
                }
              />
              <div className="flex flex-wrap gap-2">
                {modelTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`px-3 py-1.5 border rounded text-sm font-medium transition ${
                      pendingModelType === option.value
                        ? "border-logo-primary bg-logo-primary/10 text-text"
                        : "border-mid-gray/30 text-mid-gray hover:border-logo-primary"
                    }`}
                    onClick={() => setPendingModelType(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {pendingModelType === "other" && (
                <input
                  className="w-full rounded border border-mid-gray/30 px-3 py-1 text-sm focus:border-logo-primary focus:outline-none"
                  placeholder="输入自定义模型标签"
                  value={customTypeLabel}
                  onChange={(event) => setCustomTypeLabel(event.target.value)}
                />
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsModelPickerOpen(false)}
                >
                  取消
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    !pendingModelId || availableModels.length === 0 || isUpdating("cached_model_add")
                  }
                  onClick={async () => {
                    if (pendingModelId) {
                      await handleAddModel(pendingModelId, pendingModelType);
                      setPendingModelId(null);
                      setPendingModelType("text");
                      setIsModelPickerOpen(false);
                    }
                  }}
                >
                  确定
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-semibold">已配置模型</p>
          {cachedModels.length === 0 ? (
            <p className="text-sm text-mid-gray">
              暂未添加任何模型，先在上方从 Provider 中添加一个吧。
            </p>
          ) : (
            cachedModels.map((cachedModel) => {
              const isUpdatingType = isUpdating(
                `cached_model_update:${cachedModel.id}`,
              );
              const isRemoving = isUpdating(
                `cached_model_remove:${cachedModel.id}`,
              );
              return (
                <div
                  key={cachedModel.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-mid-gray/10 bg-background-ui p-3"
                >
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-semibold text-text">
                      {cachedModel.name}
                    </p>
                    <p className="text-xs text-mid-gray/70">
                      Provider: {cachedModel.provider_id}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {modelTypeOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`px-2 py-1 text-xs font-semibold rounded border transition ${
                          cachedModel.model_type === option.value
                            ? "border-logo-primary bg-logo-primary/10 text-text"
                            : "border-mid-gray/30 text-mid-gray hover:border-logo-primary"
                        }`}
                        onClick={() =>
                          handleTypeUpdate(
                            cachedModel.id,
                            option.value as ModelType,
                          )
                        }
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    onClick={() => handleRemoveModel(cachedModel.id)}
                    variant="ghost"
                    size="sm"
                    disabled={!!isRemoving}
                  >
                    删除
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </SettingContainer>
  );
};

ModelConfigurationPanel.displayName = "ModelConfigurationPanel";
