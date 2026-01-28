import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  RadioCards,
  SegmentedControl,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
  const [extraParamsStr, setExtraParamsStr] = useState("");

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

    let extra_params = undefined;
    if (extraParamsStr.trim()) {
      try {
        // Simple attempt to fix "loose" JSON (e.g. {key: "value"} or single quotes)
        let fixedJson = extraParamsStr.trim();
        if (fixedJson.startsWith("{") && fixedJson.endsWith("}")) {
          fixedJson = fixedJson
            // Fix unquoted keys
            .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
            // Fix single quotes to double quotes (naive check)
            .replace(/'/g, '"')
            // Remove trailing commas
            .replace(/,\s*([}\]])/g, "$1");
        }
        extra_params = JSON.parse(fixedJson);
        if (typeof extra_params !== "object" || extra_params === null) {
          throw new Error("Must be a JSON object");
        }
      } catch (e) {
        // If fixing fails, try the original one last time before giving up
        try {
          extra_params = JSON.parse(extraParamsStr);
        } catch (e2) {
          toast.error(
            t(
              "settings.postProcessing.models.selectModel.invalidJson",
              "无效的 JSON 格式",
            ),
          );
          return;
        }
      }
    }

    const newModel: CachedModel = {
      id: buildCacheId(pendingModelId, providerState.selectedProviderId),
      name: pendingModelId,
      model_type: pendingModelType,
      provider_id: providerState.selectedProviderId,
      model_id: pendingModelId,
      added_at: new Date().toISOString(),
      custom_label: customTypeLabel.trim() || undefined,
      is_thinking_model:
        extra_params?.["extended_thinking"] === true ||
        extra_params?.["thinking"] === true,
      extra_params,
    };
    await addCachedModel(newModel);
    setIsModelPickerOpen(false);
    setPendingModelId("");
    setCustomTypeLabel("");
    setIsManualModelEntry(false);
    setExtraParamsStr("");
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
            {/* Extra Params (JSON) */}
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">
                {t(
                  "settings.postProcessing.models.selectModel.extraParams",
                  "额外请求参数 (JSON)",
                )}
              </Text>
              <TextArea
                placeholder='例如: {"extended_thinking": true}'
                value={extraParamsStr}
                onChange={(e) => setExtraParamsStr(e.target.value)}
                style={{
                  height: "80px",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              />
              <Text size="1" color="gray" mt="1">
                支持简写格式如 &#123;key: "value"&#125;，添加时将自动纠正。
              </Text>
            </Box>
            {/* Model Nickname / Alias */}
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">
                {t(
                  "settings.postProcessing.models.selectModel.customLabel",
                  "模型昵称 / 别名 (可选)",
                )}
              </Text>
              <TextField.Root
                placeholder={t(
                  "settings.postProcessing.models.selectModel.customLabelPlaceholder",
                  "例如: 我的 DeepSeek, 高速翻译模型",
                )}
                value={customTypeLabel}
                onChange={(e) => setCustomTypeLabel(e.target.value)}
              />
            </Box>
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
