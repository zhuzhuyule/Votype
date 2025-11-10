import React, { useMemo, useState, useCallback, useEffect } from "react";

import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { SettingContainer } from "../../ui/SettingContainer";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { useSettings } from "../../../hooks/useSettings";
import type { ModelType, CachedModel } from "../../../lib/types";

const modelTypeOptions = [
  { value: "text", label: "Text", hint: "用于 Prompt 处理与润色" },
  { value: "asr", label: "ASR", hint: "用于在线语音识别" },
  { value: "other", label: "Other", hint: "自定义用途标签" },
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
    async (modelId: string, modelType: ModelType, customLabel?: string) => {
      if (!providerId) return;
      const newModel: CachedModel = {
        id: buildCacheId(modelId, providerId),
        name: modelId,
        model_type: modelType,
        provider_id: providerId,
        model_id: modelId,
        added_at: new Date().toISOString(),
        custom_label: customLabel ? customLabel.trim() : undefined,
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

  useEffect(() => {
    if (pendingModelType !== "other") {
      setCustomTypeLabel("");
    }
  }, [pendingModelType]);

  // 打开弹窗时自动刷新模型列表
  useEffect(() => {
    if (isModelPickerOpen && !state.isFetchingModels) {
      state.handleRefreshModels();
    }
  }, [isModelPickerOpen, state]);

  return (
    <SettingContainer title="" description="" layout="stacked" descriptionMode="inline" grouped={true}>
      <div className="space-y-5 relative">
        {isModelPickerOpen && (
          <>
            {/* 背景遮罩 */}
            <div
              className="fixed top-0 left-0 w-screen h-screen z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => {
                setIsModelPickerOpen(false);
                setCustomTypeLabel("");
                setPendingModelType("text");
              }}
            />
            {/* 居中弹窗 */}
            <div className="fixed left-1/2 top-1/2 z-50 w-[400px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-mid-gray/25 bg-white p-6 shadow-2xl">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-text mb-1">
                    选择模型
                  </p>
                  <p className="text-xs text-mid-gray/70 leading-relaxed">
                    从当前 Provider 返回的模型中选择要缓存的条目，然后设定用途。
                  </p>
                </div>
                <Select
                  value={pendingModelId}
                  options={availableModels}
                  onChange={(value) => setPendingModelId(value)}
                  onCreateOption={(inputValue) => {
                    const trimmedValue = inputValue.trim();
                    setPendingModelId(trimmedValue);
                    return trimmedValue;
                  }}
                  isCreatable
                  formatCreateLabel={(input) => `使用 "${input.trim()}"`}
                  onBlur={() => {}}
                  placeholder={
                    availableModels.length === 0
                      ? "暂无可添加的模型"
                      : "选择或输入模型名称"
                  }
                />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-mid-gray/80">
                    选择用途类型
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {modelTypeOptions.map((option) => {
                      const isActive = pendingModelType === option.value;
                      return (
                        <button
                          key={option.value}
                          className={`w-full rounded-lg border px-4 py-3 text-left transition-all duration-200 hover:shadow-md ${
                            isActive
                              ? "border-logo-primary bg-logo-primary/10 text-text shadow-md ring-1 ring-logo-primary/20"
                              : "border-mid-gray/25 text-mid-gray hover:border-mid-gray/50 hover:bg-mid-gray/5"
                          }`}
                          onClick={() => setPendingModelType(option.value)}
                          type="button"
                        >
                          <p className="text-sm font-semibold flex items-center justify-between">
                            <span>{option.label}</span>
                            {isActive && (
                              <span className="text-[10px] uppercase tracking-wide text-logo-primary bg-logo-primary/15 px-2 py-0.5 rounded-full">
                                已选择
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-mid-gray/70 mt-1 leading-relaxed">
                            {option.hint}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {pendingModelType === "other" && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-mid-gray/80">
                      自定义标签
                    </p>
                    <input
                      className="w-full rounded-lg border border-mid-gray/30 px-3 py-2 text-sm focus:border-logo-primary focus:outline-none focus:ring-2 focus:ring-logo-primary/20 transition-all"
                      placeholder="输入自定义模型标签"
                      value={customTypeLabel}
                      onChange={(event) =>
                        setCustomTypeLabel(event.target.value)
                      }
                    />
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsModelPickerOpen(false);
                      setCustomTypeLabel("");
                      setPendingModelType("text");
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={
                      !pendingModelId ||
                      availableModels.length === 0 ||
                      isUpdating("cached_model_add") ||
                      (pendingModelType === "other" && !customTypeLabel.trim())
                    }
                    onClick={async () => {
                      if (pendingModelId) {
                        await handleAddModel(
                          pendingModelId,
                          pendingModelType,
                          pendingModelType === "other"
                            ? customTypeLabel
                            : undefined,
                        );
                        setPendingModelId(null);
                        setPendingModelType("text");
                        setCustomTypeLabel("");
                        setIsModelPickerOpen(false);
                      }
                    }}
                  >
                    确定
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-text">模型配置</p>
            <Button
              onClick={() => setIsModelPickerOpen(true)}
              variant="primary"
              disabled={state.isFetchingModels}
              className="shadow-sm hover:shadow-md transition-shadow"
            >
              + 添加模型
            </Button>
          </div>
          {cachedModels.length === 0 ? (
            <div className="text-center py-6 px-4 rounded-lg border-2 border-dashed border-mid-gray/20 bg-mid-gray/5">
              <p className="text-sm text-mid-gray/70 mb-1">暂未添加任何模型</p>
              <p className="text-xs text-mid-gray/50">
                先在上方从 Provider 中添加一个吧
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ASR 模型分组 */}
              {(() => {
                const asrModels = cachedModels.filter(
                  (model) => model.model_type === "asr",
                );
                if (asrModels.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-1 rounded-full border border-blue-200">
                        ASR ({asrModels.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {asrModels.map((cachedModel) => {
                        const isRemoving = isUpdating(
                          `cached_model_remove:${cachedModel.id}`,
                        );
                        return (
                          <div
                            key={cachedModel.id}
                            className="flex items-center justify-between p-3 rounded-lg border border-mid-gray/20 bg-white hover:bg-mid-gray/5 transition-colors"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <p className="text-sm font-medium text-text truncate">
                                {cachedModel.name}
                              </p>
                              <span className="text-xs text-mid-gray/70 flex-shrink-0">
                                {cachedModel.provider_id}
                              </span>
                              {cachedModel.custom_label && (
                                <span className="text-xs text-logo-primary font-medium bg-logo-primary/10 px-2 py-0.5 rounded">
                                  {cachedModel.custom_label}
                                </span>
                              )}
                            </div>
                            <Button
                              onClick={() => handleRemoveModel(cachedModel.id)}
                              variant="ghost"
                              size="sm"
                              disabled={!!isRemoving}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                            >
                              删除
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Text 模型分组 */}
              {(() => {
                const textModels = cachedModels.filter(
                  (model) => model.model_type === "text",
                );
                if (textModels.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full border border-green-200">
                        TEXT ({textModels.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {textModels.map((cachedModel) => {
                        const isRemoving = isUpdating(
                          `cached_model_remove:${cachedModel.id}`,
                        );
                        return (
                          <div
                            key={cachedModel.id}
                            className="flex items-center justify-between p-3 rounded-lg border border-mid-gray/20 bg-white hover:bg-mid-gray/5 transition-colors"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <p className="text-sm font-medium text-text truncate">
                                {cachedModel.name}
                              </p>
                              <span className="text-xs text-mid-gray/70 flex-shrink-0">
                                {cachedModel.provider_id}
                              </span>
                              {cachedModel.custom_label && (
                                <span className="text-xs text-logo-primary font-medium bg-logo-primary/10 px-2 py-0.5 rounded">
                                  {cachedModel.custom_label}
                                </span>
                              )}
                            </div>
                            <Button
                              onClick={() => handleRemoveModel(cachedModel.id)}
                              variant="ghost"
                              size="sm"
                              disabled={!!isRemoving}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                            >
                              删除
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Other 模型分组 */}
              {(() => {
                const otherModels = cachedModels.filter(
                  (model) => model.model_type === "other",
                );
                if (otherModels.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded-full border border-gray-200">
                        OTHER ({otherModels.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {otherModels.map((cachedModel) => {
                        const isRemoving = isUpdating(
                          `cached_model_remove:${cachedModel.id}`,
                        );
                        return (
                          <div
                            key={cachedModel.id}
                            className="flex items-center justify-between p-3 rounded-lg border border-mid-gray/20 bg-white hover:bg-mid-gray/5 transition-colors"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <p className="text-sm font-medium text-text truncate">
                                {cachedModel.name}
                              </p>
                              <span className="text-xs text-mid-gray/70 flex-shrink-0">
                                {cachedModel.provider_id}
                              </span>
                              {cachedModel.custom_label && (
                                <span className="text-xs text-logo-primary font-medium bg-logo-primary/10 px-2 py-0.5 rounded">
                                  {cachedModel.custom_label}
                                </span>
                              )}
                            </div>
                            <Button
                              onClick={() => handleRemoveModel(cachedModel.id)}
                              variant="ghost"
                              size="sm"
                              disabled={!!isRemoving}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                            >
                              删除
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </SettingContainer>
  );
};

ModelConfigurationPanel.displayName = "ModelConfigurationPanel";
