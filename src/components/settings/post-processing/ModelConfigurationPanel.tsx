import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  Box,
  Button,
  Card,
  Dialog,
  Flex,
  Grid,
  RadioCards,
  SegmentedControl,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel, ModelType } from "../../../lib/types";

import { Dropdown } from "../../ui/Dropdown";
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
      <Dialog.Root open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>{t("modelConfiguration.selectModel")}</Dialog.Title>
          <Dialog.Description>
            {t("modelConfiguration.selectModelDescription")}
          </Dialog.Description>

          <Flex direction="column" gap="4" mt="4">
            <SegmentedControl.Root
              defaultValue="select"
              onValueChange={(value) => {
                setIsManualModelEntry(value === "custom");
                if (value === "select") {
                  setPendingModelId(availableModels[0]?.value || null);
                } else {
                  setPendingModelId("");
                }
              }}
            >
              <SegmentedControl.Item value="select">
                {t("modelConfiguration.segmented.selectModel")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="custom">
                {t("modelConfiguration.segmented.customModel")}
              </SegmentedControl.Item>
            </SegmentedControl.Root>

            {isManualModelEntry ? (
              <TextField.Root
                placeholder={t("modelConfiguration.customModelPlaceholder")}
                value={pendingModelId || ""}
                onChange={(event) => setPendingModelId(event.target.value)}
              />
            ) : (
              <Dropdown
                options={availableModels}
                selectedValue={pendingModelId || undefined}
                onSelect={(value) => setPendingModelId(value)}
                placeholder={
                  availableModels.length === 0
                    ? t("modelConfiguration.placeholderEmpty")
                    : t("modelConfiguration.placeholder")
                }
                onRefresh={() => state.handleRefreshModels()}
                className="w-full"
                enableFilter={true}
              />
            )}

            <Box>
              <Text size="2" weight="medium" mb="2">
                {t("modelConfiguration.usageTypeTitle")}
              </Text>
              <RadioCards.Root
                columns="3"
                value={pendingModelType}
                onValueChange={(value) =>
                  setPendingModelType(value as ModelType)
                }
              >
                {localizedModelTypeOptions.map((option) => (
                  <RadioCards.Item key={option.value} value={option.value}>
                    <Flex direction="column">
                      <Text size="2" weight="medium">
                        {option.label}
                      </Text>
                      <Text size="1" color="gray">
                        {option.hint}
                      </Text>
                    </Flex>
                  </RadioCards.Item>
                ))}
              </RadioCards.Root>
            </Box>

            {pendingModelType === "other" && (
              <Box>
                <Text size="2" weight="medium" mb="1">
                  {t("modelConfiguration.customLabelTitle")}
                </Text>
                <TextField.Root
                  placeholder={t("modelConfiguration.customLabelPlaceholder")}
                  value={customTypeLabel}
                  onChange={(event) => setCustomTypeLabel(event.target.value)}
                />
              </Box>
            )}
          </Flex>

          <Flex justify="end" gap="3" mt="5">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                {t("modelConfiguration.cancel")}
              </Button>
            </Dialog.Close>
            <Dialog.Close>
              <Button
                variant="solid"
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
                    setIsManualModelEntry(false);
                  }
                }}
              >
                {t("modelConfiguration.confirm")}
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

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
              count: cachedModels.filter(
                (model) => model.model_type === "other",
              ).length,
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
          <Box className="space-y-6">
            {MODEL_TYPE_ORDER.map((modelType) => {
              const models = cachedModels.filter(
                (model) => model.model_type === modelType,
              );
              if (models.length === 0) return null;

              return (
                <Box key={modelType} className="space-y-3">
                  <Flex align="center" gap="2">
                    <Text
                      size="2"
                      weight="medium"
                      className="px-3 py-1 rounded-full border border-mid-gray/30 text-text"
                    >
                      {t(MODEL_TYPE_INFO[modelType].labelKey)}
                    </Text>
                    <Text size="1" color="gray">
                      {models.length} {t("common.models")}
                    </Text>
                  </Flex>
                  <Grid columns="3" gap="3">
                    {models.map((cachedModel) => {
                      const isRemoving = isUpdating(
                        `cached_model_remove:${cachedModel.id}`,
                      );
                      return (
                        <Card key={cachedModel.id} variant="surface">
                          <Flex direction="column" gap="2" height="100%">
                            <Flex justify="between" align="start">
                              <Flex direction="column" gap="1">
                                <Text size="2" weight="medium">
                                  {cachedModel.name}
                                </Text>
                                <Text size="1" color="gray">
                                  {providerNameMap[cachedModel.provider_id] ??
                                    cachedModel.provider_id}
                                </Text>
                              </Flex>
                              <Button
                                onClick={() =>
                                  handleRemoveModel(cachedModel.id)
                                }
                                variant="ghost"
                                size="1"
                                disabled={!!isRemoving}
                                color="red"
                              >
                                {t("modelConfiguration.remove")}
                              </Button>
                            </Flex>
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
                        </Card>
                      );
                    })}
                  </Grid>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </SettingContainer>
  );
};

ModelConfigurationPanel.displayName = "ModelConfigurationPanel";
