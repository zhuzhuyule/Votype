import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Box, Button, Flex, Text, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel, ModelType } from "../../../lib/types";
import { Select } from "../../ui/Select";
import { SettingContainer } from "../../ui/SettingContainer";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";

const MODEL_TYPE_INFO: Record<
  ModelType,
  { labelKey: string; hintKey: string }
> = {
  text: {
    labelKey: "modelConfiguration.modelTypes.text.label",
    hintKey: "modelConfiguration.modelTypes.text.hint",
  },
  asr: {
    labelKey: "modelConfiguration.modelTypes.asr.label",
    hintKey: "modelConfiguration.modelTypes.asr.hint",
  },
  other: {
    labelKey: "modelConfiguration.modelTypes.other.label",
    hintKey: "modelConfiguration.modelTypes.other.hint",
  },
};

const MODEL_TYPE_ORDER: ModelType[] = ["text", "asr", "other"];

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

  const { t } = useTranslation();
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [pendingModelType, setPendingModelType] = useState<ModelType>("text");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [isManualModelEntry, setIsManualModelEntry] = useState(false);

  const cachedModels = settings?.cached_models ?? [];
  const providerId = state.selectedProviderId;
  const providerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers.forEach((provider) => {
      map[provider.id] = provider.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const configuredIds = useMemo(() => {
    return new Set(cachedModels.map((model) => model.model_id));
  }, [cachedModels]);

  const localizedModelTypeOptions = useMemo(
    () =>
      MODEL_TYPE_ORDER.map((modelType) => ({
        value: modelType,
        label: t(MODEL_TYPE_INFO[modelType].labelKey),
        hint: t(MODEL_TYPE_INFO[modelType].hintKey),
      })),
    [t],
  );

  const availableModels = useMemo(() => {
    return state.modelOptions.filter(
      (option) => option.value && !configuredIds.has(option.value),
    );
  }, [state.modelOptions, configuredIds]);

  useEffect(() => {
    if (availableModels.length === 0) {
      if (!isManualModelEntry) {
        setPendingModelId(null);
      }
      return;
    }
    setPendingModelId((current) => {
      if (isManualModelEntry && current) {
        return current;
      }
      if (
        current &&
        availableModels.some((option) => option.value === current)
      ) {
        return current;
      }
      return availableModels[0].value;
    });
  }, [availableModels, isManualModelEntry]);

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
    <SettingContainer
      title=""
      description=""
      layout="stacked"
      descriptionMode="inline"
      grouped={true}
    >
      {isModelPickerOpen && (
        <>
          {/* 背景遮罩 */}
          <Box
            className="fixed top-0 left-0 w-screen h-screen z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => {
              setIsModelPickerOpen(false);
              setCustomTypeLabel("");
              setPendingModelType("text");
              setIsManualModelEntry(false);
            }}
          />
          {/* 居中弹窗 */}
          <Box className="fixed left-1/2 top-1/2 z-50 w-[400px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-mid-gray/25 bg-background p-6 shadow-2xl">
            <Box className="space-y-4">
              <Box>
                <Text size="2" weight="medium" className="mb-1">
                  {t("modelConfiguration.selectModel")}
                </Text>
                <Text size="1" color="gray">
                  {t("modelConfiguration.selectModelDescription")}
                </Text>
              </Box>
              <Select
                value={pendingModelId}
                options={availableModels}
                onChange={(value) => {
                  setPendingModelId(value);
                  setIsManualModelEntry(false);
                }}
                onCreateOption={(inputValue) => {
                  const trimmedValue = inputValue.trim();
                  if (!trimmedValue) return;
                  setPendingModelId(trimmedValue);
                  setIsManualModelEntry(true);
                }}
                isCreatable
                formatCreateLabel={(input) =>
                  t("modelConfiguration.formatCreate", {
                    value: input.trim(),
                  })
                }
                onBlur={() => {}}
                placeholder={
                  availableModels.length === 0
                    ? t("modelConfiguration.placeholderEmpty")
                    : t("modelConfiguration.placeholder")
                }
              />
              <Box className="space-y-2">
                <Text size="1" weight="medium" color="gray">
                  {t("modelConfiguration.usageTypeTitle")}
                </Text>
                <Flex direction="column" gap="2">
                  {localizedModelTypeOptions.map((option) => {
                    const isActive = pendingModelType === option.value;
                    return (
                      <Button
                        key={option.value}
                        variant={isActive ? "solid" : "outline"}
                        color={isActive ? "blue" : undefined}
                        className="justify-start h-auto py-3 px-4"
                        onClick={() => setPendingModelType(option.value)}
                      >
                        <Flex align="center" justify="between" width="100%">
                          <Text size="2" weight="medium">
                            {option.label}
                          </Text>
                          {isActive && (
                            <Text
                              size="1"
                              weight="medium"
                              className="uppercase tracking-wide px-2 py-0.5 rounded-full border border-mid-gray/20 text-logo-primary"
                            >
                              {t("modelConfiguration.selectedBadge")}
                            </Text>
                          )}
                        </Flex>
                        <Text size="1" color="gray" className="mt-1">
                          {option.hint}
                        </Text>
                      </Button>
                    );
                  })}
                </Flex>
              </Box>
              {pendingModelType === "other" && (
                <Box className="space-y-2">
                  <Text size="1" weight="medium" color="gray">
                    {t("modelConfiguration.customLabelTitle")}
                  </Text>
                  <TextField.Root
                    className="w-full"
                    type="text"
                    placeholder={t("modelConfiguration.customLabelPlaceholder")}
                    value={customTypeLabel}
                    onChange={(event) => setCustomTypeLabel(event.target.value)}
                  />
                </Box>
              )}
              <Flex justify="end" gap="3" className="pt-2">
                <Button
                  variant="ghost"
                  size="1"
                  onClick={() => {
                    setIsModelPickerOpen(false);
                    setCustomTypeLabel("");
                    setPendingModelType("text");
                    setIsManualModelEntry(false);
                  }}
                >
                  {t("modelConfiguration.cancel")}
                </Button>
                <Button
                  variant="solid"
                  size="1"
                  disabled={
                    !pendingModelId ||
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
                  {t("modelConfiguration.confirm")}
                </Button>
              </Flex>
            </Box>
          </Box>
        </>
      )}

      <Box className="space-y-4">
        <Flex align="center" justify="between">
          <Text size="2" weight="medium">
            {t("modelConfiguration.title")}
          </Text>
          <Button
            onClick={() => setIsModelPickerOpen(true)}
            variant="solid"
            disabled={state.isFetchingModels}
            className="shadow-sm hover:shadow-md transition-shadow"
          >
            {t("modelConfiguration.addModel")}
          </Button>
        </Flex>
        <Text size="1" color="gray" className="max-w-prose">
          {t("modelConfiguration.description")}
        </Text>
        <Flex wrap="wrap" gap="2" className="gap-4">
          <Text size="1" className="text-mid-gray/80">
            {t("modelConfiguration.stats.asr", {
              count: cachedModels.filter((model) => model.model_type === "asr")
                .length,
            })}
          </Text>
          <Text size="1" className="text-mid-gray/80">
            {t("modelConfiguration.stats.text", {
              count: cachedModels.filter((model) => model.model_type === "text")
                .length,
            })}
          </Text>
          <Text size="1" className="text-mid-gray/80">
            {t("modelConfiguration.stats.other", {
              count: cachedModels.filter((model) => model.model_type === "other")
                .length,
            })}
          </Text>
        </Flex>
        {cachedModels.length === 0 ? (
          <Box className="text-center py-6 px-4 rounded-lg border-2 border-dashed border-mid-gray/20 bg-mid-gray/5">
          <Text size="2" className="mb-1 text-mid-gray">
            {t("modelConfiguration.emptyTitle")}
          </Text>
          <Text size="1" className="text-mid-gray/70">
            {t("modelConfiguration.emptyDescription")}
          </Text>
          </Box>
        ) : (
          <Box className="space-y-4">
            {/* ASR 模型分组 */}
            {(() => {
              const asrModels = cachedModels.filter(
                (model) => model.model_type === "asr",
              );
              if (asrModels.length === 0) return null;
              return (
                <Box className="space-y-2">
                  <Flex align="center" gap="2">
                    <Text
                      size="1"
                      weight="medium"
                      className="px-2 py-1 rounded-full border border-mid-gray/30 text-text"
                    >
                      {t("modelConfiguration.groups.asr", {
                        count: asrModels.length,
                      })}
                    </Text>
                  </Flex>
                  <Box className="space-y-1">
                    {asrModels.map((cachedModel) => {
                      const isRemoving = isUpdating(
                        `cached_model_remove:${cachedModel.id}`,
                      );
                      return (
                        <Flex
                          key={cachedModel.id}
                          align="center"
                          gap="3"
                          justify="between"
                          className="p-3 rounded-lg border border-mid-gray/20 bg-background hover:bg-background/40 transition-colors"
                        >
                          <Flex align="center" gap="3" className="flex-1 min-w-0">
                            <Text
                              size="2"
                              weight="medium"
                              className="truncate"
                            >
                              {cachedModel.name}
                            </Text>
                            <Text size="1" className="flex-shrink-0 text-mid-gray/70">
                              {providerNameMap[cachedModel.provider_id] ??
                                cachedModel.provider_id}
                            </Text>
                            {cachedModel.custom_label && (
                              <Text
                                size="1"
                                weight="medium"
                                className="px-2 py-0.5 rounded bg-background/60 text-logo-primary border border-logo-primary/30"
                              >
                                {cachedModel.custom_label}
                              </Text>
                            )}
                          </Flex>
                          <Button
                            onClick={() => handleRemoveModel(cachedModel.id)}
                            variant="ghost"
                            size="1"
                            disabled={!!isRemoving}
                            className="flex-shrink-0"
                          >
                            {t("modelConfiguration.remove")}
                          </Button>
                        </Flex>
                      );
                    })}
                  </Box>
                </Box>
              );
            })()}

            {/* Text 模型分组 */}
            {(() => {
              const textModels = cachedModels.filter(
                (model) => model.model_type === "text",
              );
              if (textModels.length === 0) return null;
              return (
                <Box className="space-y-2">
                  <Flex align="center" gap="2">
                    <Text
                      size="1"
                      weight="medium"
                      className="px-2 py-1 rounded-full border border-mid-gray/30 text-text"
                    >
                      {t("modelConfiguration.groups.text", {
                        count: textModels.length,
                      })}
                    </Text>
                  </Flex>
                  <Box className="space-y-1">
                    {textModels.map((cachedModel) => {
                      const isRemoving = isUpdating(
                        `cached_model_remove:${cachedModel.id}`,
                      );
                      return (
                        <Flex
                          key={cachedModel.id}
                          align="center"
                          gap="3"
                          justify="between"
                          className="p-3 rounded-lg border border-mid-gray/20 bg-background hover:bg-background/40 transition-colors"
                        >
                          <Flex align="center" gap="3" className="flex-1 min-w-0">
                            <Text
                              size="2"
                              weight="medium"
                              className="truncate"
                            >
                              {cachedModel.name}
                            </Text>
                            <Text size="1" className="flex-shrink-0 text-mid-gray/70">
                              {providerNameMap[cachedModel.provider_id] ??
                                cachedModel.provider_id}
                            </Text>
                            {cachedModel.custom_label && (
                              <Text
                                size="1"
                                weight="medium"
                                className="px-2 py-0.5 rounded bg-background/60 text-logo-primary border border-logo-primary/30"
                              >
                                {cachedModel.custom_label}
                              </Text>
                            )}
                          </Flex>
                          <Button
                            onClick={() => handleRemoveModel(cachedModel.id)}
                            variant="ghost"
                            size="1"
                            disabled={!!isRemoving}
                            className="flex-shrink-0"
                          >
                            {t("modelConfiguration.remove")}
                          </Button>
                        </Flex>
                      );
                    })}
                  </Box>
                </Box>
              );
            })()}

            {/* Other 模型分组 */}
            {(() => {
              const otherModels = cachedModels.filter(
                (model) => model.model_type === "other",
              );
              if (otherModels.length === 0) return null;
              return (
                <Box className="space-y-2">
                  <Flex align="center" gap="2">
                    <Text
                      size="1"
                      weight="medium"
                      className="px-2 py-1 rounded-full border border-mid-gray/30 text-text"
                    >
                      {t("modelConfiguration.groups.other", {
                        count: otherModels.length,
                      })}
                    </Text>
                  </Flex>
                  <Box className="space-y-1">
                    {otherModels.map((cachedModel) => {
                      const isRemoving = isUpdating(
                        `cached_model_remove:${cachedModel.id}`,
                      );
                      return (
                        <Flex
                          key={cachedModel.id}
                          align="center"
                          gap="3"
                          justify="between"
                          className="p-3 rounded-lg border border-mid-gray/20 bg-background hover:bg-background/40 transition-colors"
                        >
                          <Flex align="center" gap="3" className="flex-1 min-w-0">
                            <Text
                              size="2"
                              weight="medium"
                              className="truncate"
                            >
                              {cachedModel.name}
                            </Text>
                            <Text size="1" className="flex-shrink-0 text-mid-gray/70">
                              {providerNameMap[cachedModel.provider_id] ??
                                cachedModel.provider_id}
                            </Text>
                            {cachedModel.custom_label && (
                              <Text
                                size="1"
                                weight="medium"
                                className="px-2 py-0.5 rounded bg-background/60 text-logo-primary border border-logo-primary/30"
                              >
                                {cachedModel.custom_label}
                              </Text>
                            )}
                          </Flex>
                          <Button
                            onClick={() => handleRemoveModel(cachedModel.id)}
                            variant="ghost"
                            size="1"
                            disabled={!!isRemoving}
                            className="flex-shrink-0"
                          >
                            {t("modelConfiguration.remove")}
                          </Button>
                        </Flex>
                      );
                    })}
                  </Box>
                </Box>
              );
            })()}
          </Box>
        )}
      </Box>
    </SettingContainer>
  );
};

ModelConfigurationPanel.displayName = "ModelConfigurationPanel";
