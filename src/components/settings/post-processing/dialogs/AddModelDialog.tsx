import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Select,
  Switch,
  Tabs,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { IconChevronDown, IconSettings } from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSettings } from "../../../../hooks/useSettings";
import type { CachedModel, ModelType } from "../../../../lib/types";
import { Dropdown } from "../../../ui/Dropdown";
import type { PostProcessProviderState } from "../../PostProcessingSettingsApi/usePostProcessProviderState";

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

// Map our provider IDs to the worker API's provider field
const PROVIDER_TO_WORKER: Record<string, string> = {
  gitee: "gitee",
  xingchen: "xunfei",
};

const buildCacheId = (modelId: string, providerId: string) => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${providerId}-${modelId}-${Date.now()}`;
};

interface AddModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerState: PostProcessProviderState;
  isFetchingModels: boolean;
}

export const AddModelDialog: React.FC<AddModelDialogProps> = ({
  open,
  onOpenChange,
  providerState,
  isFetchingModels,
}) => {
  const { t } = useTranslation();
  const { settings, addCachedModel, isUpdating } = useSettings();

  // --- Dialog specific state ---
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [pendingModelType, setPendingModelType] = useState<ModelType>("text");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [isManualModelEntry, setIsManualModelEntry] = useState(false);
  const [extraParamsStr, setExtraParamsStr] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const [freeModels, setFreeModels] = useState<{ id: string; name: string; capabilities: string; provider: string; vendor: string }[]>([]);
  const [freeModelsLoading, setFreeModelsLoading] = useState(false);
  const [useOfficialModels, setUseOfficialModels] = useState(false);
  const [modelFamily, setModelFamily] = useState<string | undefined>();
  const [modelFamilies, setModelFamilies] = useState<[string, string][]>([]);
  const [autoDetectedFamily, setAutoDetectedFamily] = useState<
    string | undefined
  >();

  const cachedModels = settings?.cached_models ?? [];
  const configuredIds = useMemo(
    () => new Set(cachedModels.map((m) => m.model_id)),
    [cachedModels],
  );

  const availableModels = useMemo(() => {
    // Map options to include Badges for existing models
    return providerState.modelOptions.map((option) => {
      const existing = cachedModels.filter((m) => m.model_id === option.value);

      // If no existing, just return simple option
      if (existing.length === 0) {
        return {
          value: option.value,
          label: option.value,
          searchValue: option.value,
        };
      }

      // Render rich label with tags
      return {
        value: option.value,
        label: (
          <Flex
            align="center"
            gap="2"
            style={{ width: "100%", overflow: "hidden" }}
          >
            <Text truncate style={{ flexShrink: 0 }}>
              {option.value}
            </Text>
            <Flex gap="1" wrap="wrap" style={{ overflow: "hidden" }}>
              {existing.map((m) => (
                <Badge key={m.id} color="gray" variant="soft" radius="full">
                  {m.custom_label || "Added"}
                </Badge>
              ))}
            </Flex>
          </Flex>
        ),
        searchValue: option.value, // Search by model ID
      };
    });
  }, [providerState.modelOptions, cachedModels]);

  // Built-in free models as dropdown options
  const builtinModelOptions = useMemo(() => {
    return freeModels
      .filter((m) => m.capabilities === "文本生成" || m.capabilities === "speech2text" || m.capabilities === "多模态")
      .map((m) => {
        const existing = cachedModels.filter((cm) => cm.model_id === m.id);
        if (existing.length === 0) {
          return {
            value: m.id,
            label: `${m.name}`,
            searchValue: `${m.id} ${m.name} ${m.vendor}`,
          };
        }
        return {
          value: m.id,
          label: (
            <Flex align="center" gap="2" style={{ width: "100%", overflow: "hidden" }}>
              <Text truncate style={{ flexShrink: 0 }}>{m.name}</Text>
              <Flex gap="1" wrap="wrap" style={{ overflow: "hidden" }}>
                {existing.map((cm) => (
                  <Badge key={cm.id} color="gray" variant="soft" radius="full">
                    {cm.custom_label || "Added"}
                  </Badge>
                ))}
              </Flex>
            </Flex>
          ),
          searchValue: `${m.id} ${m.name} ${m.vendor}`,
        };
      });
  }, [freeModels, cachedModels]);

  // The active model options depend on the toggle
  const activeModelOptions = useOfficialModels ? availableModels : builtinModelOptions;

  const localizedModelTypeOptions = useMemo(
    () =>
      MODEL_TYPE_ORDER.map((modelType) => ({
        value: modelType,
        label: t(MODEL_TYPE_INFO[modelType].label),
        hint: t(MODEL_TYPE_INFO[modelType].hint),
      })),
    [t],
  );

  // Load free models on dialog open (always, for built-in mode)
  useEffect(() => {
    if (open) {
      setFreeModelsLoading(true);
      const workerProvider = PROVIDER_TO_WORKER[providerState.selectedProviderId] ?? null;
      invoke<{ id: string; name: string; capabilities: string; provider: string; vendor: string }[]>(
        "get_free_models",
        { provider: workerProvider },
      )
        .then((models) => setFreeModels(models))
        .catch((e) => {
          console.error("[AddModelDialog] get_free_models failed:", e);
          setFreeModels([]);
        })
        .finally(() => setFreeModelsLoading(false));
    }
  }, [open, providerState.selectedProviderId]);

  // Only fetch from provider API when official mode is enabled
  useEffect(() => {
    if (open && useOfficialModels && !isFetchingModels) {
      providerState.handleRefreshModels();
    }
  }, [open, useOfficialModels]);

  useEffect(() => {
    if (pendingModelType !== "other") setCustomTypeLabel("");
  }, [pendingModelType]);

  // Auto-detect thinking support when model or provider changes
  const updateThinkingConfig = useCallback(
    async (modelId: string | null, enabled: boolean) => {
      if (!modelId || !providerState.selectedProviderId) {
        setSupportsThinking(false);
        return;
      }
      try {
        const config = await invoke<string | null>("get_thinking_config", {
          modelId,
          providerId: providerState.selectedProviderId,
          enabled,
          customLabel: customTypeLabel || null,
        });
        setSupportsThinking(config !== null);
        if (config !== null) {
          setExtraParamsStr(config);
        }
      } catch {
        setSupportsThinking(false);
      }
    },
    [providerState.selectedProviderId],
  );

  // Load model families on mount
  useEffect(() => {
    invoke<[string, string][]>("get_model_families")
      .then((families) => {
        console.log("[AddModelDialog] model families loaded:", families);
        setModelFamilies(families);
      })
      .catch((e) => {
        console.error("[AddModelDialog] get_model_families failed:", e);
        setModelFamilies([]);
      });
  }, []);

  useEffect(() => {
    if (pendingModelId) {
      updateThinkingConfig(pendingModelId, thinkingEnabled);
      // Auto-detect model family
      invoke<string | null>("detect_model_family_cmd", {
        modelId: pendingModelId,
        customLabel: customTypeLabel || null,
      })
        .then((family) => {
          setAutoDetectedFamily(family ?? undefined);
          setModelFamily(family ?? undefined);
        })
        .catch(() => {
          setAutoDetectedFamily(undefined);
          setModelFamily(undefined);
        });
    } else {
      setSupportsThinking(false);
      setAutoDetectedFamily(undefined);
      setModelFamily(undefined);
    }
  }, [pendingModelId, providerState.selectedProviderId]);

  // Smart Deduplication & Initialization Effect
  useEffect(() => {
    if (isManualModelEntry) return;

    if (!pendingModelId) {
      if (activeModelOptions.length > 0 && !pendingModelId) {
        setPendingModelId(activeModelOptions[0].value);
      }
      return;
    }

    // Smart Alias Logic
    // If model already exists, suggest a unique alias
    const existing = cachedModels.filter((m) => m.model_id === pendingModelId);
    if (existing.length > 0) {
      // Find a unique name based on the model ID or the last alias
      // We prefer to base it on the model_id to keep it clean, or the last user alias?
      // User request: "Smart deduplication... subsequent added items should automatically take '123'"

      // Simple strategy: Start with ModelID (or last alias base) and increment
      const baseName = pendingModelId;

      let counter = 1;
      let candidate = `${baseName} ${counter}`;

      // Check uniqueness against ALL cached models custom_labels and names
      const layoutNames = new Set(
        cachedModels.map((m) => m.custom_label || m.model_id),
      );

      while (layoutNames.has(candidate)) {
        counter++;
        candidate = `${baseName} ${counter}`;
      }
      setCustomTypeLabel(candidate);
    } else {
      setCustomTypeLabel(""); // Reset if new
    }
  }, [pendingModelId, isManualModelEntry, cachedModels, activeModelOptions]);

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

        // If object is empty, set to undefined
        if (Object.keys(extra_params).length === 0) {
          extra_params = undefined;
        }
      } catch (e) {
        // If fixing fails, try the original one last time before giving up
        try {
          extra_params = JSON.parse(extraParamsStr);
          if (typeof extra_params === "object" && extra_params !== null) {
            if (Object.keys(extra_params).length === 0) {
              extra_params = undefined;
            }
          }
        } catch (e2) {
          toast.error(
            t(
              "settings.postProcessing.models.selectModel.invalidJson",
              "Invalid JSON format",
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
      is_thinking_model: thinkingEnabled,
      prompt_message_role: developerMode ? "developer" : "system",
      extra_params,
      model_family: modelFamily,
    };
    await addCachedModel(newModel);
    onOpenChange(false);
    setPendingModelId("");
    setCustomTypeLabel("");
    setIsManualModelEntry(false);
    setExtraParamsStr("");
    setThinkingEnabled(false);
    setSupportsThinking(false);
    setDeveloperMode(false);
    setModelFamily(undefined);
    setAutoDetectedFamily(undefined);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="500px">
        <Dialog.Title>
          {t("settings.postProcessing.models.selectModel.title")}
        </Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          {t("settings.postProcessing.models.selectModel.description")}
        </Dialog.Description>

        <Flex direction="column" gap="5">
          {/* Input Method Tabs */}
          <Tabs.Root
            defaultValue="select"
            value={isManualModelEntry ? "custom" : "select"}
            onValueChange={(val) => {
              setIsManualModelEntry(val === "custom");
              if (val === "select")
                setPendingModelId(activeModelOptions[0]?.value || null);
              else setPendingModelId("");
            }}
          >
            <Tabs.List className="w-full grid grid-cols-2 mb-4">
              <Tabs.Trigger value="select">
                {t(
                  "settings.postProcessing.models.selectModel.segmented.selectModel",
                )}
              </Tabs.Trigger>
              <Tabs.Trigger value="custom">
                {t(
                  "settings.postProcessing.models.selectModel.segmented.customModel",
                )}
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="select">
              <Box className="space-y-4">
                {/* Source toggle: Built-in vs Official */}
                <Flex align="center" justify="between" className="px-1">
                  <Flex direction="column" gap="0.5">
                    <Text size="2" weight="medium">
                      {useOfficialModels
                        ? t("settings.postProcessing.models.selectModel.sourceOfficial", "Official Model List")
                        : t("settings.postProcessing.models.selectModel.sourceBuiltin", "Built-in Free Models")}
                    </Text>
                    <Text size="1" color="gray">
                      {useOfficialModels
                        ? t("settings.postProcessing.models.selectModel.sourceOfficialHint", "Fetched from provider API")
                        : t("settings.postProcessing.models.selectModel.sourceBuiltinHint", "Curated free models, no API call needed")}
                    </Text>
                  </Flex>
                  <Switch
                    size="1"
                    checked={useOfficialModels}
                    onCheckedChange={setUseOfficialModels}
                  />
                </Flex>

                <Box>
                  <Text size="2" mb="2" weight="medium" color="gray">
                    {t(
                      "settings.postProcessing.models.selectModel.selectLabel",
                      "Available Models",
                    )}
                  </Text>
                  <Dropdown
                    options={activeModelOptions}
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
                </Box>
              </Box>
            </Tabs.Content>

            <Tabs.Content value="custom">
              <Box className="space-y-4">
                <Box>
                  <Text size="2" mb="2" weight="medium" color="gray">
                    {t(
                      "settings.postProcessing.models.selectModel.manualLabel",
                      "Model ID / Name",
                    )}
                  </Text>
                  <TextField.Root
                    placeholder={t(
                      "settings.postProcessing.models.selectModel.customModelPlaceholder",
                    )}
                    value={pendingModelId || ""}
                    onChange={(e) => setPendingModelId(e.target.value)}
                  />
                </Box>
              </Box>
            </Tabs.Content>
          </Tabs.Root>

          {/* Model Family */}
          {pendingModelId && (
            <Box>
              <Text size="2" weight="medium" mb="2" color="gray">
                {t("settings.postProcessing.models.modelFamily", "模型系列")}
              </Text>
              <Select.Root
                value={modelFamily || "__unknown__"}
                onValueChange={(v) =>
                  setModelFamily(v === "__unknown__" ? undefined : v)
                }
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="__unknown__">
                    {t("settings.postProcessing.models.familyUnknown", "未知")}
                  </Select.Item>
                  {modelFamilies.map(([id, displayName]) => (
                    <Select.Item key={id} value={id}>
                      {displayName}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {autoDetectedFamily && modelFamily === autoDetectedFamily && (
                <Text size="1" color="blue" mt="1" as="div">
                  {t(
                    "settings.postProcessing.models.familyAutoDetected",
                    "已自动识别，将应用推荐参数",
                  )}
                </Text>
              )}
            </Box>
          )}

          {/* Model Type - Always visible but styled better */}
          <Box>
            <Text size="2" weight="medium" mb="2" color="gray">
              {t("settings.postProcessing.models.selectModel.usageTypeTitle")}
            </Text>
            <Grid columns="3" gap="2">
              {localizedModelTypeOptions.map((o) => {
                const isSelected = pendingModelType === o.value;
                return (
                  <Box
                    key={o.value}
                    onClick={() => setPendingModelType(o.value as ModelType)}
                    className={`
                        cursor-pointer rounded-lg border p-3 transition-colors text-center
                        ${
                          isSelected
                            ? "bg-(--accent-3) border-(--accent-8)"
                            : "bg-(--gray-2) border-transparent hover:bg-(--gray-4)"
                        }
                      `}
                  >
                    <Flex direction="column" align="center" gap="1">
                      {/* Icons could be mapped here if imports available, for now text */}
                      <Text
                        size="2"
                        weight={isSelected ? "bold" : "medium"}
                        color={isSelected ? "blue" : undefined}
                      >
                        {o.label}
                      </Text>
                      <Text size="1" color="gray" style={{ lineHeight: "1.2" }}>
                        {o.hint}
                      </Text>
                    </Flex>
                  </Box>
                );
              })}
            </Grid>
          </Box>

          {/* Advanced Settings (Collapsible) */}
          <Box>
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors select-none py-2">
                <IconSettings size={16} />
                {t(
                  "settings.postProcessing.models.selectModel.advancedOptions",
                  "Advanced Configuration",
                )}
                <IconChevronDown
                  size={14}
                  className="group-open:rotate-180 transition-transform"
                />
              </summary>
              <Box className="pt-2 pl-2 border-l-2 border-(--gray-4) space-y-4 ml-2 mt-1">
                {/* Model Nickname */}
                <Box>
                  <Text size="2" weight="medium" mb="1" as="div">
                    {t(
                      "settings.postProcessing.models.selectModel.customLabel",
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

                {/* Thinking Mode Toggle */}
                {supportsThinking && (
                  <Flex align="center" justify="between">
                    <Text size="2" weight="medium">
                      {t(
                        "settings.postProcessing.models.thinkingMode.label",
                        "Thinking",
                      )}
                    </Text>
                    <Switch
                      size="1"
                      checked={thinkingEnabled}
                      onCheckedChange={(checked) => {
                        const enabled = !!checked;
                        setThinkingEnabled(enabled);
                        updateThinkingConfig(pendingModelId, enabled);
                      }}
                    />
                  </Flex>
                )}

                {/* Developer Mode Toggle */}
                <Flex align="center" justify="between">
                  <Text size="2" weight="medium">
                    {t(
                      "settings.postProcessing.models.promptMessageRole.label",
                      "Developer mode",
                    )}
                  </Text>
                  <Switch
                    size="1"
                    checked={developerMode}
                    onCheckedChange={(checked) => setDeveloperMode(!!checked)}
                  />
                </Flex>

                {/* Extra Params (JSON) */}
                <Box>
                  <Flex justify="between" align="baseline" mb="1">
                    <Text size="2" weight="medium">
                      {t(
                        "settings.postProcessing.models.selectModel.extraParams",
                      )}
                    </Text>
                    <Text size="1" color="gray">
                      JSON
                    </Text>
                  </Flex>
                  <TextArea
                    placeholder='e.g. {"extended_thinking": true}'
                    value={extraParamsStr}
                    onChange={(e) => setExtraParamsStr(e.target.value)}
                    className="font-mono text-xs bg-(--gray-2)"
                    rows={3}
                  />
                  <Text size="1" color="gray" mt="1">
                    Supports simplified format like &#123;key: "value"&#125;
                  </Text>
                </Box>
              </Box>
            </details>
          </Box>

          <Flex justify="end" gap="3" mt="2">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                {t("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button
              variant="solid"
              onClick={handleAddModel}
              disabled={!pendingModelId || isUpdating("cached_model_add")}
            >
              {t("common.add")}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};
