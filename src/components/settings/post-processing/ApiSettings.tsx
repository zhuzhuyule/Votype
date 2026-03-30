import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  IconButton,
  ScrollArea,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconBolt,
  IconBrain,
  IconCpu,
  IconEye,
  IconEyeOff,
  IconHexagonLetterA,
  IconLayoutGrid,
  IconPlug,
  IconPlugConnected,
  IconPlus,
  IconRobot,
  IconServer,
  IconTrash,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel } from "../../../lib/types";
import { Card } from "../../ui/Card";
import type { PostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { AdvancedSettings } from "./AdvancedSettings";
import { PROVIDER_BRAND_ASSETS } from "./providerBrandAssets";
import { type ProviderTemplate, PROVIDER_TEMPLATES } from "./providerTemplates";
import { SidebarItem } from "./SidebarItem";

const getProviderGlyph = (
  providerId: string,
  baseUrl: string,
): React.ElementType | null => {
  const normalized = `${providerId} ${baseUrl}`.toLowerCase();

  if (normalized.includes("ollama")) return IconRobot;
  if (normalized.includes("lmstudio") || normalized.includes("lm-studio")) {
    return IconLayoutGrid;
  }
  if (normalized.includes("localai")) return IconServer;
  if (normalized.includes("vllm")) return IconCpu;
  if (normalized.includes("xinference")) return IconHexagonLetterA;
  if (normalized.includes("custom")) return IconPlug;

  return null;
};

interface ApiSettingsProps {
  isFetchingModels: boolean;
  providerState: PostProcessProviderState;
  onOpenAddModel: () => void;
}

const getProviderMeta = (providerId: string) => {
  switch (providerId) {
    case "openai":
      return { label: "OA", tone: "bg-emerald-500/15 text-emerald-700" };
    case "openrouter":
      return { label: "OR", tone: "bg-violet-500/15 text-violet-700" };
    case "anthropic":
      return { label: "AN", tone: "bg-amber-500/15 text-amber-700" };
    case "apple_intelligence":
      return { label: "AI", tone: "bg-slate-500/15 text-slate-700" };
    case "custom":
      return { label: "CU", tone: "bg-sky-500/15 text-sky-700" };
    default:
      return { label: "CP", tone: "bg-gray-500/15 text-gray-700" };
  }
};

const ProviderAvatar: React.FC<{
  providerId: string;
  baseUrl: string;
  large?: boolean;
}> = ({ providerId, baseUrl, large = false }) => {
  const staticAssetUrl = PROVIDER_BRAND_ASSETS[providerId] ?? null;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(staticAssetUrl);
  const Glyph = getProviderGlyph(providerId, baseUrl);
  const meta = getProviderMeta(providerId);
  const sizeClass = large
    ? "h-10 w-10 rounded-xl text-sm"
    : "h-6 w-6 rounded-md text-[10px]";

  useEffect(() => {
    if (staticAssetUrl) {
      setAvatarUrl(staticAssetUrl);
      return;
    }

    let cancelled = false;

    const trimmed = baseUrl.trim();
    if (!trimmed || trimmed.startsWith("apple-intelligence://")) {
      setAvatarUrl(null);
      return;
    }

    invoke<string | null>("get_provider_avatar_path", {
      providerId,
    })
      .then((filePath) => {
        if (cancelled) return;
        setAvatarUrl(filePath ? convertFileSrc(filePath, "asset") : null);
      })
      .catch(() => {
        if (!cancelled) {
          setAvatarUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [providerId, baseUrl, staticAssetUrl]);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${sizeClass} shrink-0 object-cover bg-white/80 p-1`}
        onError={() => setAvatarUrl(null)}
      />
    );
  }

  if (Glyph) {
    return (
      <Box
        className={`inline-flex! shrink-0 items-center justify-center ${sizeClass} ${meta.tone}`}
      >
        <Glyph size={large ? 18 : 14} className="block opacity-90" />
      </Box>
    );
  }

  return (
    <Box
      className={`inline-flex! shrink-0 items-center justify-center text-center leading-none font-semibold ${sizeClass} ${meta.tone} ${large ? "text-base" : "text-xs"}`}
    >
      {meta.label}
    </Box>
  );
};

export const ApiSettings: React.FC<ApiSettingsProps> = ({
  isFetchingModels,
  providerState: state,
  onOpenAddModel,
}) => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const {
    settings,
    updateCustomProvider,
    removeCustomProvider,
    addCustomProvider,
    removeCachedModel,
    isUpdating,
  } = useSettings();

  const [localBaseUrl, setLocalBaseUrl] = useState(state.baseUrl);
  const [localApiKey, setLocalApiKey] = useState(state.apiKey);
  const [editingName, setEditingName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const selectedProviderLabel = state.selectedProvider?.label ?? "";
  const providerModels = useMemo<CachedModel[]>(() => {
    return (settings?.cached_models ?? [])
      .filter((model) => model.provider_id === state.selectedProviderId)
      .sort((a, b) => {
        const left = a.custom_label || a.model_id;
        const right = b.custom_label || b.model_id;
        return left.localeCompare(right);
      });
  }, [settings?.cached_models, state.selectedProviderId]);

  const visibleProviders = useMemo(() => {
    return state.providers.filter((provider) => {
      if (!provider.builtin) return true;
      if (provider.id === state.selectedProviderId) return true;

      const hasApiKey = !!state.apiKeys?.[provider.id]?.trim();
      const hasModel = !!settings?.post_process_models?.[provider.id]?.trim();
      const hasCachedModel = (settings?.cached_models ?? []).some(
        (model) => model.provider_id === provider.id,
      );

      return hasApiKey || hasModel || hasCachedModel;
    });
  }, [
    settings?.cached_models,
    settings?.post_process_models,
    state.apiKeys,
    state.providers,
    state.selectedProviderId,
  ]);

  const groupedTemplates = useMemo(() => {
    return PROVIDER_TEMPLATES.reduce<Record<string, ProviderTemplate[]>>(
      (groups, template) => {
        if (!groups[template.category]) {
          groups[template.category] = [];
        }
        groups[template.category].push(template);
        return groups;
      },
      {},
    );
  }, []);

  const getTemplateHost = (baseUrl: string) => {
    if (!baseUrl.trim()) return "Custom endpoint";
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  };

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
    if (editingName.trim() && editingName !== selectedProviderLabel) {
      await updateCustomProvider({
        providerId: state.selectedProviderId,
        label: editingName.trim(),
      });
    } else {
      setEditingName(selectedProviderLabel);
    }
  };

  const handleAddProvider = async (template: ProviderTemplate) => {
    const provider = await addCustomProvider({
      label: template.label,
      baseUrl: template.baseUrl,
      modelsEndpoint: template.modelsEndpoint,
    });
    setShowTemplatePicker(false);
    await state.handleProviderSelect(provider.id);
  };

  const sortedOptions = useMemo(() => {
    const visibleProviderIds = new Set(
      visibleProviders.map((provider) => provider.id),
    );
    return state.providerOptions.filter((option) =>
      visibleProviderIds.has(option.value),
    );
  }, [state.providerOptions, visibleProviders]);

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
            <Dialog.Root
              open={showTemplatePicker}
              onOpenChange={setShowTemplatePicker}
            >
              <Dialog.Trigger>
                <IconButton
                  variant="ghost"
                  size="1"
                  className="cursor-pointer text-gray-500 hover:text-(--accent-11)"
                  title={t("settings.postProcessing.api.providers.add")}
                >
                  <IconPlus size={16} />
                </IconButton>
              </Dialog.Trigger>
              <Dialog.Content maxWidth="860px" className="p-0 overflow-hidden">
                <Dialog.Title>
                  {t("settings.postProcessing.api.providers.add")}
                </Dialog.Title>
                <Box className="h-[70vh] max-h-160 overflow-hidden py-2 pl-2">
                  <ScrollArea
                    scrollbars="vertical"
                    type="hover"
                    className="h-[400px] overflow-auto pr-4"
                  >
                    <Flex direction="column" gap="4" className="pr-2 py-1">
                      {Object.entries(groupedTemplates).map(
                        ([category, templates]) => (
                          <Box key={category}>
                            <Text
                              size="1"
                              weight="bold"
                              className="mb-1! block  text-gray-500"
                            >
                              {category}
                            </Text>
                            <Grid
                              columns={{ initial: "2", sm: "3", lg: "4" }}
                              gap="2"
                            >
                              {templates.map((template) => (
                                <button
                                  key={template.id}
                                  type="button"
                                  onClick={() =>
                                    void handleAddProvider(template)
                                  }
                                  className="group w-full rounded-2xl border border-(--gray-a4) bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,248,250,0.9))] px-3 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all duration-200 hover:border-(--accent-a6) hover:shadow-[0_10px_28px_rgba(16,24,40,0.08)] dark:bg-[linear-gradient(180deg,rgba(30,30,34,0.88),rgba(24,24,28,0.92))] cursor-pointer"
                                >
                                  <Flex align="center" gap="3">
                                    <Flex
                                      align="center"
                                      gap="3"
                                      className="min-w-0"
                                    >
                                      <ProviderAvatar
                                        providerId={template.id}
                                        baseUrl={template.baseUrl}
                                        large
                                      />
                                      <Flex
                                        direction="column"
                                        justify="between"
                                        className="min-w-0 flex-1"
                                        style={{ minHeight: 40 }}
                                      >
                                        <Text
                                          size="2"
                                          weight="medium"
                                          className="block truncate text-(--gray-12)"
                                          title={template.label}
                                        >
                                          {template.label}
                                        </Text>
                                        <Text
                                          size="1"
                                          color="gray"
                                          className="block truncate leading-[1.2]"
                                          title={getTemplateHost(
                                            template.baseUrl,
                                          )}
                                        >
                                          {getTemplateHost(template.baseUrl)}
                                        </Text>
                                      </Flex>
                                    </Flex>
                                  </Flex>
                                </button>
                              ))}
                            </Grid>
                          </Box>
                        ),
                      )}
                    </Flex>
                  </ScrollArea>
                </Box>
              </Dialog.Content>
            </Dialog.Root>
          </Flex>
          <Box className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {sortedOptions.map((option) => (
              <SidebarItem
                key={option.value}
                option={option}
                isSelected={state.selectedProviderId === option.value}
                isVerified={state.verifiedProviderIds.has(option.value)}
                onClick={() => state.handleProviderSelect(option.value)}
                onActivate={() => state.activateProvider(option.value)}
                t={t}
                iconNode={
                  <ProviderAvatar
                    providerId={option.value}
                    baseUrl={
                      state.providers.find(
                        (provider) => provider.id === option.value,
                      )?.base_url ?? ""
                    }
                  />
                }
              />
            ))}
          </Box>
        </Flex>

        {/* Content Area */}
        <Flex direction="column" className="h-full overflow-hidden">
          {/* Header */}
          <Box className="pt-6 px-8 pb-2 shrink-0">
            <Flex justify="between" align="center" width="100%">
              <Flex align="center" gap="3" className="min-w-0 flex-1">
                <ProviderAvatar
                  providerId={state.selectedProviderId}
                  baseUrl={state.selectedProvider?.base_url ?? ""}
                  large
                />
                <Box className="min-w-0 flex-1">
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
                    className="max-w-sm font-medium"
                  />
                  <Flex align="center" gap="2" mt="2">
                    <Badge variant="soft" color="gray" size="1">
                      {state.selectedProvider?.builtin
                        ? t("settings.postProcessing.api.provider.builtin")
                        : "Custom"}
                    </Badge>
                    <Text size="1" color="gray">
                      {providerModels.length} model
                      {providerModels.length === 1 ? "" : "s"}
                    </Text>
                  </Flex>
                </Box>
              </Flex>
              <Flex align="center" gap="2">
                <Button
                  variant="soft"
                  onClick={onOpenAddModel}
                  disabled={!state.selectedProviderId}
                >
                  <IconPlus size={14} />
                  {t("settings.postProcessing.models.selectModel.addButton")}
                </Button>
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
                          onClick={async () => {
                            const deletedId = state.selectedProviderId;
                            const fallback = sortedOptions.find(
                              (p) => p.value !== deletedId,
                            );
                            if (fallback) {
                              await state.handleProviderSelect(fallback.value);
                            }
                            await removeCustomProvider(deletedId);
                          }}
                        >
                          {t("common.delete")}
                        </Button>
                      </Dialog.Close>
                    </Flex>
                  </Dialog.Content>
                </Dialog.Root>
              </Flex>
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

            <Flex direction="column" gap="3">
              <Flex align="center" justify="between">
                <Text size="2" weight="medium" color="gray">
                  Added Models
                </Text>
                {providerModels.length > 0 && (
                  <Badge variant="soft" color="gray">
                    {providerModels.length}
                  </Badge>
                )}
              </Flex>
              {providerModels.length === 0 ? (
                <Card className="border border-dashed border-(--gray-a5) bg-(--gray-a2) p-4">
                  <Flex align="center" justify="between" gap="4">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">
                        No models added yet
                      </Text>
                      <Text size="1" color="gray">
                        Add a model from this provider to start using it faster.
                      </Text>
                    </Flex>
                    <Button variant="soft" onClick={onOpenAddModel}>
                      <IconPlus size={14} />
                      Add Model
                    </Button>
                  </Flex>
                </Card>
              ) : (
                <Flex direction="column" gap="2">
                  {providerModels.map((model) => (
                    <Card
                      key={model.id}
                      className="border border-(--gray-a4) bg-(--gray-a2) p-3"
                    >
                      <Flex align="center" justify="between" gap="3">
                        <Flex align="center" gap="2" className="min-w-0">
                          {model.model_type === "text" ? (
                            <IconBolt
                              size={15}
                              className="text-(--accent-10) shrink-0"
                            />
                          ) : model.model_type === "asr" ? (
                            <IconCpu
                              size={15}
                              className="text-sky-600 shrink-0"
                            />
                          ) : (
                            <IconWorld
                              size={15}
                              className="text-violet-600 shrink-0"
                            />
                          )}
                          <Box className="min-w-0">
                            <Text size="2" weight="medium" className="truncate">
                              {model.custom_label || model.model_id}
                            </Text>
                            <Flex align="center" gap="2" mt="1">
                              {model.custom_label && (
                                <Text
                                  size="1"
                                  color="gray"
                                  className="truncate"
                                >
                                  {model.model_id}
                                </Text>
                              )}
                              {model.is_thinking_model && (
                                <Badge size="1" color="amber" variant="soft">
                                  <IconBrain size={12} />
                                  Thinking
                                </Badge>
                              )}
                            </Flex>
                          </Box>
                        </Flex>
                        <IconButton
                          size="1"
                          variant="ghost"
                          color="red"
                          disabled={isUpdating(
                            `cached_model_remove:${model.id}`,
                          )}
                          onClick={() => void removeCachedModel(model.id)}
                          title={t("common.delete")}
                        >
                          <IconX size={14} />
                        </IconButton>
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              )}
            </Flex>

            {/* Advanced Settings */}
            <AdvancedSettings
              modelsEndpoint={state.modelsEndpoint}
              onModelsEndpointChange={state.handleModelsEndpointChange}
            />
          </Box>
        </Flex>
      </Grid>
    </Card>
  );
};
