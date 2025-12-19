import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  IconButton,
  RadioCards,
  SegmentedControl,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconPlugConnected,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel, ModelType } from "../../../lib/types";
import { Dropdown } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ModelListPanel } from "./ModelConfigurationPanel";
import { ProviderManager } from "./ProviderManager";

// --- Helpers & Types for Dialog ---
const MODEL_TYPE_INFO: Record<
  ModelType,
  { labelKey: string; hintKey: string }
> = {
  text: {
    labelKey: "settings.postProcessing.models.modelTypes.text.label",
    hintKey: "settings.postProcessing.models.modelTypes.text.hint",
  },
  asr: {
    labelKey: "settings.postProcessing.models.modelTypes.asr.label",
    hintKey: "settings.postProcessing.models.modelTypes.asr.hint",
  },
  other: {
    labelKey: "settings.postProcessing.models.modelTypes.other.label",
    hintKey: "settings.postProcessing.models.modelTypes.other.hint",
  },
};
const MODEL_TYPE_ORDER: ModelType[] = ["text", "asr", "other"];

const buildCacheId = (modelId: string, providerId: string) => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${providerId}-${modelId}-${Date.now()}`;
};

interface AdvancedSettingsProps {
  modelsEndpoint: string;
  onModelsEndpointChange: (value: string) => void;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  modelsEndpoint,
  onModelsEndpointChange,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState(modelsEndpoint);

  useEffect(() => {
    setLocalEndpoint(modelsEndpoint);
  }, [modelsEndpoint]);

  return (
    <Box>
      <Flex
        align="center"
        gap="1"
        onClick={() => setIsOpen(!isOpen)}
        className="cursor-pointer select-none text-gray-500 hover:text-gray-700 w-fit mb-2"
      >
        {isOpen ? (
          <IconChevronDown size={14} />
        ) : (
          <IconChevronRight size={14} />
        )}
        <Text size="2" weight="medium">
          {t("settings.postProcessing.api.providers.advancedSettings")}
        </Text>
      </Flex>

      {isOpen && (
        <Flex direction="column" gap="2">
          <Text size="2" weight="medium" color="gray">
            {t("settings.postProcessing.api.providers.fields.modelsEndpoint")}
          </Text>
          <TextField.Root
            value={localEndpoint}
            onChange={(e) => setLocalEndpoint(e.target.value)}
            onBlur={(e) => onModelsEndpointChange(e.target.value)}
            placeholder={t(
              "settings.postProcessing.api.providers.fields.modelsEndpointPlaceholder",
            )}
            variant="surface"
          />
        </Flex>
      )}
    </Box>
  );
};

interface ApiSettingsProps {
  onAddModel: () => void;
  isFetchingModels: boolean;
}

const ApiSettings: React.FC<ApiSettingsProps> = ({
  onAddModel,
  isFetchingModels,
}) => {
  const { t } = useTranslation();
  const state = usePostProcessProviderState();
  const [showApiKey, setShowApiKey] = useState(false);

  const [localBaseUrl, setLocalBaseUrl] = useState(state.baseUrl);
  const [localApiKey, setLocalApiKey] = useState(state.apiKey);

  React.useEffect(() => {
    setLocalBaseUrl(state.baseUrl);
  }, [state.baseUrl]);

  React.useEffect(() => {
    setLocalApiKey(state.apiKey);
  }, [state.apiKey]);

  return (
    <Box>
      <Grid columns="2" gap="5">
        <Box className="col-span-2">
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium" color="gray">
              {t("settings.postProcessing.api.provider.title")}
            </Text>
            <ProviderSelect
              options={state.providerOptions}
              value={state.selectedProviderId}
              onChange={state.handleProviderSelect}
            />
          </Flex>
        </Box>

        <Box>
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium" color="gray">
              {t("settings.postProcessing.api.baseUrl.title")}
            </Text>
            <TextField.Root
              value={localBaseUrl}
              onChange={(e) => setLocalBaseUrl(e.target.value)}
              onBlur={(e) => state.handleBaseUrlChange(e.target.value)}
              placeholder={t("settings.postProcessing.api.baseUrl.placeholder")}
              disabled={state.isBaseUrlUpdating}
              variant="surface"
            />
          </Flex>
        </Box>

        <Box>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium" color="gray">
                {t("settings.postProcessing.api.apiKey.title")}
              </Text>
              <Button
                variant="ghost"
                size="1"
                onClick={async () => {
                  if (!localApiKey) {
                    toast.error("API Key is required");
                    return;
                  }
                  // Ensure latest values are saved before testing
                  await state.handleBaseUrlChange(localBaseUrl);
                  await state.handleApiKeyChange(localApiKey);

                  const success = await state.testConnection();
                  if (success) {
                    toast.success(
                      t("settings.postProcessing.api.providers.testSuccess"),
                    );
                  } else {
                    toast.error(
                      t("settings.postProcessing.api.providers.testFailed", {
                        error: "",
                      }),
                      {
                        duration: Infinity,
                        closeButton: true,
                        style: { color: "red" },
                      },
                    );
                  }
                }}
                disabled={state.isFetchingModels || !localApiKey}
                className="cursor-pointer"
                color={state.isFetchingModels || !localApiKey ? "gray" : "blue"}
              >
                <IconPlugConnected size={14} />
                {t("settings.postProcessing.api.providers.testConnection")}
              </Button>
            </Flex>
            <TextField.Root
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              onBlur={(e) => state.handleApiKeyChange(e.target.value)}
              placeholder={t("settings.postProcessing.api.apiKey.placeholder")}
              type={showApiKey ? "text" : "password"}
              disabled={state.isApiKeyUpdating}
              variant="surface"
            >
              <TextField.Slot side="right">
                <IconButton
                  size="1"
                  variant="ghost"
                  onClick={() => setShowApiKey(!showApiKey)}
                  type="button"
                  color="gray"
                >
                  {showApiKey ? (
                    <IconEyeOff height={14} width={14} />
                  ) : (
                    <IconEye height={14} width={14} />
                  )}
                </IconButton>
              </TextField.Slot>
            </TextField.Root>
          </Flex>
        </Box>

        <Box className="col-span-2">
          <AdvancedSettings
            modelsEndpoint={state.modelsEndpoint}
            onModelsEndpointChange={state.handleModelsEndpointChange}
          />
        </Box>

        <Box className="col-span-2 mt-2">
          <Button
            variant="surface"
            className="w-full cursor-pointer h-9"
            onClick={onAddModel}
            disabled={isFetchingModels}
            size="2"
          >
            <IconPlus size={16} />
            {t("settings.postProcessing.models.addModel")}
          </Button>
        </Box>
      </Grid>
    </Box>
  );
};

export const ModelsConfiguration: React.FC = () => {
  const { t } = useTranslation();
  // Provider Dialog State
  const [isProviderManagerOpen, setProviderManagerOpen] = useState(false);
  const [isAddProviderDialogOpen, setAddProviderDialogOpen] = useState(false);

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
        label: t(MODEL_TYPE_INFO[modelType].labelKey),
        hint: t(MODEL_TYPE_INFO[modelType].hintKey),
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
    if (availableModels.length === 0) {
      if (!isManualModelEntry) setPendingModelId(null);
      return;
    }
    setPendingModelId((current) => {
      if (isManualModelEntry && current) return current;
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
      <SettingsGroup
        title={t("settings.postProcessing.api.title")}
        actions={
          <Button
            variant="ghost"
            size="2"
            color="gray"
            onClick={() => setProviderManagerOpen(true)}
          >
            <IconSettings className="w-4 h-4 mr-1" />
            {t("settings.postProcessing.api.manageProviders")}
          </Button>
        }
      >
        <ApiSettings
          onAddModel={() => setIsModelPickerOpen(true)}
          isFetchingModels={providerState.isFetchingModels}
        />
      </SettingsGroup>

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

      {/* Provider Manager Dialog */}
      <Dialog.Root
        open={isProviderManagerOpen}
        onOpenChange={setProviderManagerOpen}
      >
        <Dialog.Content maxWidth="900px" style={{ maxHeight: "80vh" }}>
          <Flex justify="between" align="center" mb="4">
            <Dialog.Title style={{ margin: 0 }}>
              {t("settings.postProcessing.api.manageProviders")}
            </Dialog.Title>
            <Button
              size="2"
              variant="solid"
              onClick={() => setAddProviderDialogOpen(true)}
            >
              <IconPlus size={16} />
              {t("settings.postProcessing.api.providers.add")}
            </Button>
          </Flex>

          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <ProviderManager
              onClose={() => setProviderManagerOpen(false)}
              isAddOpen={isAddProviderDialogOpen}
              onAddOpenChange={setAddProviderDialogOpen}
            />
          </div>
        </Dialog.Content>
      </Dialog.Root>

      {/* Add Model Dialog */}
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
