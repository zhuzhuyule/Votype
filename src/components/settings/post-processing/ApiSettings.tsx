import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconPlugConnected,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSettings } from "../../../hooks/useSettings";
import { Card } from "../../ui/Card";
import type { PostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { AdvancedSettings } from "./AdvancedSettings";
import { SidebarItem } from "./SidebarItem";

interface ApiSettingsProps {
  onAddModel: () => void;
  isFetchingModels: boolean;
  providerState: PostProcessProviderState;
}

export const ApiSettings: React.FC<ApiSettingsProps> = ({
  onAddModel,
  isFetchingModels,
  providerState: state,
}) => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const { updateCustomProvider, removeCustomProvider, addCustomProvider } =
    useSettings();

  const [localBaseUrl, setLocalBaseUrl] = useState(state.baseUrl);
  const [localApiKey, setLocalApiKey] = useState(state.apiKey);
  const [editingName, setEditingName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const builtinProviders = [
    "openai",
    "anthropic",
    "apple_intelligence",
    "iflow",
    "gitee",
  ];
  const isSelectedBuiltin = builtinProviders.includes(state.selectedProviderId);
  const selectedProviderLabel =
    state.providerOptions.find((p) => p.value === state.selectedProviderId)
      ?.label || "";

  // Update local state when provider changes
  useEffect(() => {
    setLocalBaseUrl(state.baseUrl);
    setLocalApiKey(state.apiKey);

    const option = state.providerOptions.find(
      (p) => p.value === state.selectedProviderId,
    );
    if (option) {
      setEditingName(option.label);
    }
  }, [
    state.baseUrl,
    state.apiKey,
    state.selectedProviderId,
    state.providerOptions,
  ]);

  const handleNameBlur = async () => {
    if (
      editingName.trim() &&
      editingName !== selectedProviderLabel &&
      !isSelectedBuiltin
    ) {
      await updateCustomProvider({
        providerId: state.selectedProviderId,
        label: editingName.trim(),
      });
    } else {
      setEditingName(selectedProviderLabel);
    }
  };

  // Find if there's already an empty custom provider (no API key configured)
  const emptyCustomProvider = useMemo(() => {
    const builtins = [
      "openai",
      "anthropic",
      "apple_intelligence",
      "iflow",
      "gitee",
    ];
    return state.providerOptions.find((p) => {
      if (builtins.includes(p.value)) return false;
      const apiKey = state.apiKeys?.[p.value] ?? "";
      return !apiKey.trim();
    });
  }, [state.providerOptions, state.apiKeys]);

  const handleAddProvider = async () => {
    // If there's already an empty custom provider, select it instead of creating a new one
    if (emptyCustomProvider) {
      state.handleProviderSelect(emptyCustomProvider.value);
      return;
    }
    await addCustomProvider({
      label: t("settings.postProcessing.api.provider.newProvider"),
      baseUrl: "",
    });
  };

  // Sort providers: Built-in first
  const sortedOptions = useMemo(() => {
    return [...state.providerOptions].sort((a, b) => {
      const aBuiltin = builtinProviders.includes(a.value);
      const bBuiltin = builtinProviders.includes(b.value);
      if (aBuiltin && !bBuiltin) return -1;
      if (!aBuiltin && bBuiltin) return 1;
      return 0;
    });
  }, [state.providerOptions]);

  return (
    <Card className="p-0! overflow-hidden">
      <Grid columns="220px 1fr" className="h-[500px]">
        {/* Sidebar */}
        <Flex
          direction="column"
          className="h-full border-r border-gray-100 dark:border-gray-800"
        >
          <Flex
            align="center"
            justify="between"
            className="pt-5 pb-2 px-4 shrink-0"
          >
            <Text size="3" weight="bold">
              {t("settings.postProcessing.api.provider.title")}
            </Text>
            <IconButton
              variant="ghost"
              size="1"
              onClick={handleAddProvider}
              className="cursor-pointer text-gray-500 hover:text-(--accent-11)"
              title={t("settings.postProcessing.api.providers.add")}
            >
              <IconPlus size={16} />
            </IconButton>
          </Flex>
          <Box className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {sortedOptions.map((option) => (
              <SidebarItem
                key={option.value}
                option={option}
                isSelected={state.selectedProviderId === option.value}
                isActive={state.activeProviderId === option.value}
                isBuiltin={builtinProviders.includes(option.value)}
                isVerified={state.verifiedProviderIds.has(option.value)}
                onClick={() => state.handleProviderSelect(option.value)}
                onActivate={() => state.activateProvider(option.value)}
                t={t}
              />
            ))}
          </Box>
        </Flex>

        {/* Content Area */}
        <Flex direction="column" className="h-full overflow-hidden">
          {/* Header */}
          <Box className="pt-6 px-8 pb-2 shrink-0">
            <Flex justify="between" align="center" width="100%">
              {isSelectedBuiltin ? (
                <Flex align="center" gap="2">
                  <Text size="4" weight="bold">
                    {selectedProviderLabel}
                  </Text>
                  <Box
                    title={t(
                      "settings.postProcessing.api.provider.builtinTooltip",
                    )}
                  >
                    <IconLock size={16} className="text-gray-400" />
                  </Box>
                </Flex>
              ) : (
                <>
                  <TextField.Root
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder={t(
                      "settings.postProcessing.api.provider.namePlaceholder",
                    )}
                    className="flex-1 max-w-sm font-medium"
                  />
                  <Dialog.Root
                    open={showDeleteConfirm}
                    onOpenChange={setShowDeleteConfirm}
                  >
                    <Dialog.Trigger>
                      <IconButton
                        variant="ghost"
                        color="red"
                        onClick={() => setShowDeleteConfirm(true)}
                        className="cursor-pointer ml-2"
                        title={t(
                          "settings.postProcessing.api.provider.deleteAction",
                        )}
                      >
                        <IconTrash size={18} />
                      </IconButton>
                    </Dialog.Trigger>
                    <Dialog.Content maxWidth="450px">
                      <Dialog.Title>
                        {t("settings.postProcessing.api.provider.deleteTitle")}
                      </Dialog.Title>
                      <Dialog.Description size="2" mb="4">
                        {t(
                          "settings.postProcessing.api.provider.deleteConfirmation",
                          { name: selectedProviderLabel },
                        )}
                      </Dialog.Description>
                      <Flex gap="3" mt="4" justify="end">
                        <Dialog.Close>
                          <Button
                            variant="soft"
                            color="gray"
                            className="cursor-pointer"
                          >
                            {t("common.cancel")}
                          </Button>
                        </Dialog.Close>
                        <Dialog.Close>
                          <Button
                            color="red"
                            className="cursor-pointer"
                            onClick={() => {
                              removeCustomProvider(state.selectedProviderId);
                            }}
                          >
                            {t("common.delete")}
                          </Button>
                        </Dialog.Close>
                      </Flex>
                    </Dialog.Content>
                  </Dialog.Root>
                </>
              )}
            </Flex>
          </Box>

          {/* Form Fields - Scrollable */}
          <Box className="px-8 py-4 flex-1 overflow-y-auto space-y-8">
            {/* Base URL */}
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium" color="gray">
                {t("settings.postProcessing.api.providers.fields.baseUrl")}
              </Text>
              <TextField.Root
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                onBlur={() => state.handleBaseUrlChange(localBaseUrl)}
                placeholder="https://api.openai.com/v1"
                className="w-full"
              />
              <Text size="1" color="gray" className="opacity-70">
                {t("settings.postProcessing.api.providers.fields.baseUrlHint")}
              </Text>
            </Flex>

            {/* API Key */}
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium" color="gray">
                {t("settings.postProcessing.api.providers.fields.apiKey")}
              </Text>
              <Flex gap="2">
                <TextField.Root
                  type={showApiKey ? "text" : "password"}
                  value={localApiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  onBlur={() => state.handleApiKeyChange(localApiKey)}
                  placeholder="sk-..."
                  className="flex-1"
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
                <Button
                  variant="solid"
                  onClick={async () => {
                    if (!localApiKey) {
                      toast.error("API Key is required");
                      return;
                    }

                    // 规范化 URL（仅去除尾部斜杠）
                    const normalizedUrl = localBaseUrl
                      .trim()
                      .replace(/\/+$/, "");

                    // 智能检测是否缺少版本路径
                    const isSpecialProtocol =
                      normalizedUrl.startsWith("apple-intelligence://") ||
                      normalizedUrl.startsWith("ollama://");
                    const hasVersionPath = /\/v\d+$/.test(normalizedUrl);

                    // 如果不是特殊协议且缺少版本路径，显示警告提示
                    if (
                      normalizedUrl &&
                      !isSpecialProtocol &&
                      !hasVersionPath
                    ) {
                      toast.warning(
                        t(
                          "settings.postProcessing.api.providers.fields.v1MissingWarning",
                        ),
                        { duration: 5000 },
                      );
                    }

                    await state.handleBaseUrlChange(normalizedUrl);
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
                      );
                    }
                  }}
                  disabled={isFetchingModels || !localApiKey}
                >
                  {isFetchingModels ? (
                    t("common.loading")
                  ) : (
                    <>
                      <IconPlugConnected size={14} />
                      {t(
                        "settings.postProcessing.api.providers.testConnection",
                      )}
                    </>
                  )}
                </Button>
              </Flex>
            </Flex>

            {/* Advanced Settings */}
            <AdvancedSettings
              modelsEndpoint={state.modelsEndpoint}
              onModelsEndpointChange={state.handleModelsEndpointChange}
            />

            {/* Add Model Button */}
            <Box className="pt-4 border-t border-gray-100 dark:border-gray-800">
              <Button
                variant="surface"
                className="w-full cursor-pointer"
                onClick={onAddModel}
                disabled={isFetchingModels}
              >
                <IconPlus size={16} />
                {t("settings.postProcessing.models.addModel")}
              </Button>
            </Box>
          </Box>
        </Flex>
      </Grid>
    </Card>
  );
};
