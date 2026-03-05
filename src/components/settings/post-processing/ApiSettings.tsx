import {
  Badge,
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
    (state.providerOptions.find((p) => p.value === state.selectedProviderId)
      ?.label as string) || "";

  // Update local state when provider changes
  useEffect(() => {
    setLocalBaseUrl(state.baseUrl);
    setLocalApiKey(state.apiKey);

    const option = state.providerOptions.find(
      (p) => p.value === state.selectedProviderId,
    );
    if (option) {
      setEditingName(option.label as string);
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
                isLocked={builtinProviders.includes(option.value)}
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
              {localBaseUrl.trim() && (
                <Flex
                  direction="column"
                  gap="1"
                  className="bg-gray-50 dark:bg-gray-800/50 p-2 rounded border border-gray-100 dark:border-gray-700/50"
                >
                  <Text size="1" color="gray" weight="medium">
                    {t(
                      "settings.postProcessing.api.providers.fields.actualUrlPreview",
                    )}
                  </Text>
                  <Text
                    size="1"
                    className="break-all font-mono opacity-80 text-(--accent-11)"
                  >
                    {(() => {
                      let url = localBaseUrl.trim();
                      let normalized = "";
                      if (url.endsWith("#")) {
                        normalized = url.slice(0, -1).replace(/\/+$/, "");
                      } else {
                        const isSpecial =
                          url.startsWith("apple-intelligence://") ||
                          url.startsWith("ollama://");
                        const base = url.replace(/\/+$/, "");
                        const hasVersion = /\/v\d+$/.test(base);

                        if (isSpecial || hasVersion) {
                          normalized = base;
                        } else {
                          normalized = base + "/v1";
                        }
                      }
                      return `${normalized}/chat/completions`;
                    })()}
                  </Text>
                </Flex>
              )}
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
                    // 允许空 API Key
                    // if (!localApiKey) {
                    //   toast.error("API Key is required");
                    //   return;
                    // }

                    // 规范化 URL（仅去除尾部斜杠）
                    let normalizedUrl = localBaseUrl.trim();

                    // 如果以 # 结尾，视为强制原始模式，移除 # 并跳过 v1 警告
                    const isRawMode = normalizedUrl.endsWith("#");
                    if (isRawMode) {
                      normalizedUrl = normalizedUrl
                        .slice(0, -1)
                        .replace(/\/+$/, "");
                    } else {
                      normalizedUrl = normalizedUrl.replace(/\/+$/, "");
                    }

                    // 智能检测是否缺少版本路径
                    const isSpecialProtocol =
                      normalizedUrl.startsWith("apple-intelligence://") ||
                      normalizedUrl.startsWith("ollama://");
                    const hasVersionPath = /\/v\d+$/.test(normalizedUrl);

                    // 如果不是特殊协议、不是原始模式且缺少版本路径，显示警告提示
                    if (
                      normalizedUrl &&
                      !isSpecialProtocol &&
                      !isRawMode &&
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

                    if (state.model) {
                      const res = await state.testInference(state.model);
                      state.setLastInferenceResult(res);
                      const { result, error, hasThinking } = res;
                      if (!error) {
                        const displayResult = hasThinking
                          ? `[Thinking] ${result}`
                          : result;
                        toast.success(
                          t(
                            "settings.postProcessing.api.providers.api.testSuccess",
                            { result: displayResult },
                          ),
                        );
                      } else {
                        toast.error(
                          t(
                            "settings.postProcessing.api.providers.api.testFailed",
                            {
                              error,
                            },
                          ),
                        );
                      }
                    } else {
                      const error = await state.testConnection();
                      if (!error) {
                        toast.success(
                          t(
                            "settings.postProcessing.api.providers.api.testSuccess",
                            { result: "OK" },
                          ),
                        );
                      } else {
                        toast.error(
                          t(
                            "settings.postProcessing.api.providers.api.testFailed",
                            {
                              error,
                            },
                          ),
                        );
                      }
                    }
                  }}
                  disabled={isFetchingModels}
                >
                  {isFetchingModels ? (
                    t("common.loading")
                  ) : (
                    <>
                      <IconPlugConnected size={14} />
                      {t(
                        "settings.postProcessing.api.providers.api.testConnection",
                      )}
                    </>
                  )}
                </Button>
              </Flex>

              {state.lastInferenceResult && (
                <Card className="p-4 bg-[var(--gray-2)] border-[1px] border-[var(--gray-5)] mt-2">
                  <Flex direction="column" gap="2">
                    <Flex align="center" gap="2">
                      <Badge
                        color={
                          state.lastInferenceResult.error ? "red" : "green"
                        }
                        variant="soft"
                        size="1"
                      >
                        {state.lastInferenceResult.error
                          ? "Failure"
                          : "Success"}
                      </Badge>
                      {state.lastInferenceResult.hasThinking && (
                        <Badge color="amber" variant="surface" size="1">
                          🧠 Thinking Model
                        </Badge>
                      )}
                    </Flex>
                    <Text
                      size="1"
                      color={
                        state.lastInferenceResult.error ? "red" : undefined
                      }
                      className="whitespace-pre-wrap font-mono break-all opacity-80"
                    >
                      {state.lastInferenceResult.error ||
                        state.lastInferenceResult.result}
                    </Text>
                  </Flex>
                </Card>
              )}
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
