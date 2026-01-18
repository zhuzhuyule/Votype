import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  RadioCards,
  SegmentedControl,
  Text,
  TextField,
} from "@radix-ui/themes";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel, ModelType } from "../../../lib/types";
import { Dropdown } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ApiSettings } from "./ApiSettings";
import { ModelListPanel } from "./ModelConfigurationPanel";

// --- Helpers & Types for Dialog ---
const MODEL_TYPE_INFO: Record<
  string,
  { label: string; icon: string; hint: string }
> = {
  text: {
    label: "settings.postProcessing.models.modelTypes.text.label",
    icon: "IconSparkles",
    hint: "settings.postProcessing.models.modelTypes.text.hint",
  },
  asr: {
    label: "settings.postProcessing.models.modelTypes.asr.label",
    icon: "IconMicrophone",
    hint: "settings.postProcessing.models.modelTypes.asr.hint",
  },
  other: {
    label: "settings.postProcessing.models.modelTypes.other.label",
    icon: "IconBolt",
    hint: "settings.postProcessing.models.modelTypes.other.hint",
  },
};

const MODEL_TYPE_ORDER: ModelType[] = ["text", "asr", "other"];

const buildCacheId = (modelId: string, providerId: string) => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${providerId}-${modelId}-${Date.now()}`;
};

export const ModelsConfiguration: React.FC = () => {
  const { t } = useTranslation();

  const providerState = usePostProcessProviderState();
  const { settings, addCachedModel, isUpdating } = useSettings();

  // ModelPicker State
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);

  // --- Dialog specific state ---
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [pendingModelType, setPendingModelType] = useState<ModelType>("text");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [isManualModelEntry, setIsManualModelEntry] = useState(false);

  const cachedModels = settings?.cached_models ?? [];
  const configuredIds = useMemo(
    () => new Set(cachedModels.map((m) => m.model_id)),
    [cachedModels],
  );

  const availableModels = useMemo(() => {
    return providerState.modelOptions.filter(
      (option) => option.value && !configuredIds.has(option.value),
    );
  }, [providerState.modelOptions, configuredIds]);

  const localizedModelTypeOptions = useMemo(
    () =>
      MODEL_TYPE_ORDER.map((modelType) => ({
        value: modelType,
        label: t(MODEL_TYPE_INFO[modelType].label),
        hint: t(MODEL_TYPE_INFO[modelType].hint),
      })),
    [t],
  );

  // Dialog Effects
  useEffect(() => {
    if (isModelPickerOpen && !providerState.isFetchingModels) {
      providerState.handleRefreshModels();
    }
  }, [isModelPickerOpen]);

  useEffect(() => {
    if (pendingModelType !== "other") setCustomTypeLabel("");
  }, [pendingModelType]);

  useEffect(() => {
    // 手动输入模式下不自动设置默认值
    if (isManualModelEntry) return;

    if (availableModels.length === 0) {
      setPendingModelId(null);
      return;
    }
    setPendingModelId((current) => {
      if (current && availableModels.some((o) => o.value === current))
        return current;
      return availableModels[0].value;
    });
  }, [availableModels, isManualModelEntry]);

  const handleAddModel = async () => {
    if (!pendingModelId || !providerState.selectedProviderId) return;
    const newModel: CachedModel = {
      id: buildCacheId(pendingModelId, providerState.selectedProviderId),
      name: pendingModelId,
      model_type: pendingModelType,
      provider_id: providerState.selectedProviderId,
      model_id: pendingModelId,
      added_at: new Date().toISOString(),
      custom_label: customTypeLabel.trim() || undefined,
    };
    await addCachedModel(newModel);
    setIsModelPickerOpen(false);
    setPendingModelId(null);
    setPendingModelType("text");
    setCustomTypeLabel("");
    setIsManualModelEntry(false);
  };

  return (
    <Flex direction="column" gap="6" className="max-w-5xl w-full mx-auto">
      {/* 1. API Configuration */}
      <ApiSettings
        onAddModel={() => setIsModelPickerOpen(true)}
        isFetchingModels={providerState.isFetchingModels}
        providerState={providerState}
      />
      {/* 2. Models Grid (Side-by-Side) */}
      <Grid columns="2" gap="4">
        {/* Text Models */}
        <SettingsGroup
          title={t("settings.postProcessing.models.modelTypes.text.label")}
        >
          <ModelListPanel targetType="text" />
        </SettingsGroup>

        {/* ASR Models */}
        <SettingsGroup
          title={t("settings.postProcessing.models.modelTypes.asr.label")}
        >
          <ModelListPanel targetType={["asr", "other"]} />
        </SettingsGroup>
      </Grid>
      <Dialog.Root open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>
            {t("settings.postProcessing.models.selectModel.title")}
          </Dialog.Title>
          <Dialog.Description>
            {t("settings.postProcessing.models.selectModel.description")}
          </Dialog.Description>

          <Flex direction="column" gap="4" mt="4">
            <SegmentedControl.Root
              defaultValue="select"
              onValueChange={(value) => {
                setIsManualModelEntry(value === "custom");
                if (value === "select")
                  setPendingModelId(availableModels[0]?.value || null);
                else setPendingModelId("");
              }}
            >
              <SegmentedControl.Item value="select">
                {t(
                  "settings.postProcessing.models.selectModel.segmented.selectModel",
                )}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="custom">
                {t(
                  "settings.postProcessing.models.selectModel.segmented.customModel",
                )}
              </SegmentedControl.Item>
            </SegmentedControl.Root>
            {isManualModelEntry ? (
              <TextField.Root
                placeholder={t(
                  "settings.postProcessing.models.selectModel.customModelPlaceholder",
                )}
                value={pendingModelId || ""}
                onChange={(e) => setPendingModelId(e.target.value)}
              />
            ) : (
              <Dropdown
                options={availableModels}
                selectedValue={pendingModelId || undefined}
                onSelect={setPendingModelId}
                placeholder={
                  availableModels.length === 0
                    ? t(
                        "settings.postProcessing.models.selectModel.placeholderEmpty",
                      )
                    : t(
                        "settings.postProcessing.models.selectModel.placeholder",
                      )
                }
                className="w-full"
                enableFilter={true}
              />
            )}
            <Box>
              <Text size="2" weight="medium" mb="2">
                {t("settings.postProcessing.models.selectModel.usageTypeTitle")}
              </Text>
              <RadioCards.Root
                columns="3"
                value={pendingModelType}
                onValueChange={(v) => setPendingModelType(v as ModelType)}
              >
                {localizedModelTypeOptions.map((o) => (
                  <RadioCards.Item key={o.value} value={o.value}>
                    <Flex direction="column">
                      <Text size="2" weight="medium">
                        {o.label}
                      </Text>
                      <Text size="1" color="gray">
                        {o.hint}
                      </Text>
                    </Flex>
                  </RadioCards.Item>
                ))}
              </RadioCards.Root>
            </Box>
            {pendingModelType === "other" && (
              <Box>
                <Text size="2" weight="medium" mb="1">
                  {t(
                    "settings.postProcessing.models.selectModel.customLabelTitle",
                  )}
                </Text>
                <TextField.Root
                  placeholder={t(
                    "settings.postProcessing.models.selectModel.customLabelPlaceholder",
                  )}
                  value={customTypeLabel}
                  onChange={(e) => setCustomTypeLabel(e.target.value)}
                />
              </Box>
            )}
            <Flex justify="end" gap="3" mt="5">
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  {t("common.cancel")}
                </Button>
              </Dialog.Close>
              <Button
                variant="solid"
                onClick={handleAddModel}
                disabled={
                  !pendingModelId ||
                  isUpdating("cached_model_add") ||
                  (pendingModelType === "other" && !customTypeLabel.trim())
                }
              >
                {t("common.add")}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};
