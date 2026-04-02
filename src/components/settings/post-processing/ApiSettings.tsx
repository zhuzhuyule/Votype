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
  IconCpu,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconHexagonLetterA,
  IconLayoutGrid,
  IconPlug,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconServer,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSettings } from "../../../hooks/useSettings";
import { Card } from "../../ui/Card";
import type { PostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { AdvancedSettings } from "./AdvancedSettings";
import {
  matchRecommendedProviderIconKeys,
  PROVIDER_BRAND_ASSETS,
  PROVIDER_ICON_CATALOG,
  resolveProviderIconAsset,
} from "./providerBrandAssets";
import {
  type ProviderTemplate,
  PROVIDER_TEMPLATES,
  RECOMMENDED_PROVIDER_TEMPLATE_IDS,
} from "./providerTemplates";
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
  refreshToken?: number;
  overrideValue?: string | null;
}> = ({
  providerId,
  baseUrl,
  large = false,
  refreshToken = 0,
  overrideValue = null,
}) => {
  const staticAssetUrl = PROVIDER_BRAND_ASSETS[providerId] ?? null;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(staticAssetUrl);
  const Glyph = getProviderGlyph(providerId, baseUrl);
  const meta = getProviderMeta(providerId);
  const frameClass = large
    ? "h-10 w-10 rounded-xl"
    : "h-7 w-7 rounded-lg bg-(--gray-a3) p-0.5";

  useEffect(() => {
    const catalogKey = overrideValue?.startsWith("catalog:")
      ? overrideValue.slice(8)
      : null;

    if (catalogKey) {
      setAvatarUrl(resolveProviderIconAsset(catalogKey));
      return;
    }

    let cancelled = false;

    const trimmed = baseUrl.trim();
    if (!trimmed || trimmed.startsWith("apple-intelligence://")) {
      setAvatarUrl(staticAssetUrl ?? null);
      return;
    }

    invoke<string | null>("get_provider_avatar_path", {
      providerId,
    })
      .then((filePath) => {
        if (cancelled) return;
        setAvatarUrl(
          filePath
            ? convertFileSrc(filePath, "asset")
            : (staticAssetUrl ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAvatarUrl(staticAssetUrl ?? null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [providerId, baseUrl, staticAssetUrl, refreshToken, overrideValue]);

  if (avatarUrl) {
    return large ? (
      <Box
        className={`inline-flex! shrink-0 items-center justify-center ${frameClass} ${meta.tone}`}
      >
        <img
          src={avatarUrl}
          alt=""
          className="block shrink-0 h- w-6 object-contain"
          onError={() => setAvatarUrl(null)}
        />
      </Box>
    ) : (
      <Box
        className={`inline-flex! shrink-0 items-center justify-center ${frameClass}`}
      >
        <img
          src={avatarUrl}
          alt=""
          className="block shrink-0 h-full w-full object-contain"
          onError={() => setAvatarUrl(null)}
        />
      </Box>
    );
  }

  if (Glyph) {
    return large ? (
      <Box
        className={`inline-flex! shrink-0 items-center justify-center ${frameClass} ${meta.tone}`}
      >
        <Glyph size={18} className="block opacity-90" strokeWidth={1.5} />
      </Box>
    ) : (
      <Box
        className={`inline-flex! shrink-0 items-center justify-center ${frameClass}`}
      >
        <Glyph size={16} className="block opacity-90" strokeWidth={1.5} />
      </Box>
    );
  }

  return large ? (
    <Box
      className={`inline-flex shrink-0 items-center justify-center text-center leading-none font-semibold text-base ${frameClass} ${meta.tone}`}
    >
      {meta.label}
    </Box>
  ) : (
    <Box
      className={`inline-flex shrink-0 items-center justify-center text-center leading-none font-semibold text-xs ${frameClass}`}
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
    refreshSettings,
  } = useSettings();

  const [localBaseUrl, setLocalBaseUrl] = useState(state.baseUrl);
  const [localApiKey, setLocalApiKey] = useState(state.apiKey);
  const [editingName, setEditingName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [avatarRefreshToken, setAvatarRefreshToken] = useState(0);
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [avatarSearch, setAvatarSearch] = useState("");

  const selectedProviderLabel = state.selectedProvider?.label ?? "";

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

  const selectedProviderAvatarOverride =
    settings?.post_process_provider_avatar_overrides?.[
      state.selectedProviderId
    ] ?? null;

  const recommendedAvatarKeys = useMemo(() => {
    const matched = matchRecommendedProviderIconKeys({
      providerId: state.selectedProviderId,
      label: state.selectedProvider?.label ?? "",
      baseUrl: state.selectedProvider?.base_url ?? "",
    });
    return matched.length > 0
      ? matched
      : PROVIDER_ICON_CATALOG.slice(0, 6).map((entry) => entry.key);
  }, [
    state.selectedProvider?.base_url,
    state.selectedProvider?.label,
    state.selectedProviderId,
  ]);

  const filteredIconCatalog = useMemo(() => {
    const query = avatarSearch.trim().toLowerCase();
    if (!query) return PROVIDER_ICON_CATALOG;

    return PROVIDER_ICON_CATALOG.filter((entry) => {
      return (
        entry.label.toLowerCase().includes(query) ||
        entry.key.toLowerCase().includes(query) ||
        entry.keywords.some((keyword) => keyword.toLowerCase().includes(query))
      );
    });
  }, [avatarSearch]);

  const orderedIconCatalog = useMemo(() => {
    const recommendedSet = new Set(recommendedAvatarKeys);
    return [...filteredIconCatalog].sort((a, b) => {
      const aRecommended = recommendedSet.has(a.key) ? 1 : 0;
      const bRecommended = recommendedSet.has(b.key) ? 1 : 0;
      if (aRecommended !== bRecommended) {
        return bRecommended - aRecommended;
      }
      return a.label.localeCompare(b.label);
    });
  }, [filteredIconCatalog, recommendedAvatarKeys]);

  const groupedTemplates = useMemo(() => {
    const recommendedSet = new Set<string>(RECOMMENDED_PROVIDER_TEMPLATE_IDS);
    const recommendedOrder = new Map<string, number>(
      RECOMMENDED_PROVIDER_TEMPLATE_IDS.map((id, index) => [id, index]),
    );

    const templates = PROVIDER_TEMPLATES.filter((t) => t.id !== "custom");

    const recommended = templates
      .filter((t) => recommendedSet.has(t.id))
      .sort(
        (a, b) =>
          (recommendedOrder.get(a.id) ?? Infinity) -
          (recommendedOrder.get(b.id) ?? Infinity),
      );

    const local = templates.filter(
      (t) => !recommendedSet.has(t.id) && t.category === "Local",
    );

    const cloud = templates.filter(
      (t) => !recommendedSet.has(t.id) && t.category !== "Local",
    );

    return [
      { key: "recommended", label: t("settings.postProcessing.api.providers.group.recommended"), templates: recommended },
      { key: "cloud", label: t("settings.postProcessing.api.providers.group.cloud"), templates: cloud },
      { key: "local", label: t("settings.postProcessing.api.providers.group.local"), templates: local },
    ].filter((g) => g.templates.length > 0);
  }, [t]);

  const getTemplateHost = (baseUrl: string) => {
    if (!baseUrl.trim()) return "Custom endpoint";
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  };

  const matchProviderTemplate = (
    providerId: string,
    baseUrl?: string,
  ): ProviderTemplate | undefined => {
    const byId = PROVIDER_TEMPLATES.find((p) => p.id === providerId);
    if (byId) return byId;
    if (!baseUrl) return undefined;
    try {
      const host = new URL(baseUrl).host;
      return PROVIDER_TEMPLATES.find((p) => {
        try {
          return new URL(p.baseUrl).host === host;
        } catch {
          return false;
        }
      });
    } catch {
      return undefined;
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

  const refreshProviderAvatar = () => {
    setAvatarRefreshToken((value) => value + 1);
  };

  const syncProviderAvatarState = async () => {
    await refreshSettings();
    refreshProviderAvatar();
  };

  const handleApplyCatalogAvatar = async (iconKey: string) => {
    if (!state.selectedProviderId) return;

    await invoke("set_provider_avatar_icon_key", {
      providerId: state.selectedProviderId,
      iconKey,
    });
    await syncProviderAvatarState();
    toast.success("Provider icon updated");
  };

  const handleSelectProviderAvatar = async () => {
    if (!state.selectedProviderId) return;

    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "svg", "ico"],
        },
      ],
    });

    if (!selected || Array.isArray(selected)) return;

    await invoke("set_provider_avatar_from_path", {
      providerId: state.selectedProviderId,
      sourcePath: selected,
    });
    await syncProviderAvatarState();
    toast.success("Provider icon updated");
  };

  const handleApplyProviderAvatarUrl = async () => {
    if (!state.selectedProviderId || !avatarUrlInput.trim()) return;

    await invoke("set_provider_avatar_from_url", {
      providerId: state.selectedProviderId,
      imageUrl: avatarUrlInput.trim(),
    });
    setAvatarUrlInput("");
    await syncProviderAvatarState();
    toast.success("Provider icon updated");
  };

  const handleRefetchProviderAvatar = async () => {
    if (!state.selectedProviderId) return;

    const result = await invoke<string | null>("refresh_provider_avatar", {
      providerId: state.selectedProviderId,
    });
    await syncProviderAvatarState();

    if (result) {
      toast.success("Provider icon refreshed");
      return;
    }

    toast.warning("No site icon found for this provider");
  };

  const handleResetProviderAvatar = async () => {
    if (!state.selectedProviderId) return;

    await invoke("reset_provider_avatar", {
      providerId: state.selectedProviderId,
    });
    await syncProviderAvatarState();
    toast.success("Provider icon reset");
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
          className="h-full overflow-hidden border-r border-gray-100 dark:border-gray-800"
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
                      {groupedTemplates.map((group) => (
                          <Box key={group.key}>
                            <Text
                              size="1"
                              weight="bold"
                              className="mb-1! block text-gray-500"
                            >
                              {group.label}
                            </Text>
                            <Grid
                              columns={{ initial: "2", sm: "3", lg: "4" }}
                              gap="2"
                            >
                              {group.templates.map((template) => (
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
                                        refreshToken={avatarRefreshToken}
                                        overrideValue={
                                          settings
                                            ?.post_process_provider_avatar_overrides?.[
                                            template.id
                                          ] ?? null
                                        }
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
                                        <Flex
                                          align="center"
                                          gap="1"
                                          className="min-w-0"
                                        >
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
                                          {template.signupUrl && (
                                            <IconExternalLink
                                              size={12}
                                              className="shrink-0 text-(--gray-8) opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void openUrl(
                                                  template.signupUrl!,
                                                );
                                              }}
                                            />
                                          )}
                                        </Flex>
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
          <ScrollArea
            scrollbars="vertical"
            type="hover"
            className="flex-1 min-h-0"
          >
            <Box className="px-2 space-y-0.5">
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
                      refreshToken={avatarRefreshToken}
                      overrideValue={
                        settings?.post_process_provider_avatar_overrides?.[
                          option.value
                        ] ?? null
                      }
                    />
                  }
                />
              ))}
            </Box>
          </ScrollArea>
        </Flex>

        {/* Content Area */}
        <Flex direction="column" className="h-full overflow-hidden">
          {/* Header */}
          <Box className="pt-6 px-8 pb-2 shrink-0">
            <Flex justify="between" align="center" width="100%">
              <Flex align="center" gap="3" className="min-w-0 flex-1">
                <Dialog.Root
                  open={showAvatarPicker}
                  onOpenChange={setShowAvatarPicker}
                >
                  <Dialog.Trigger>
                    <button
                      type="button"
                      className="cursor-pointer rounded-2xl transition-transform hover:scale-[1.02]"
                      title="Change provider icon"
                    >
                      <ProviderAvatar
                        providerId={state.selectedProviderId}
                        baseUrl={state.selectedProvider?.base_url ?? ""}
                        large
                        refreshToken={avatarRefreshToken}
                        overrideValue={selectedProviderAvatarOverride}
                      />
                    </button>
                  </Dialog.Trigger>
                  <Dialog.Content maxWidth="760px" className="max-h-[82vh]">
                    <Dialog.Title>Change Provider Icon</Dialog.Title>
                    <Box className="mt-3 space-y-4">
                      <Flex
                        align="center"
                        justify="between"
                        gap="4"
                        className="rounded-xl border border-(--gray-a4) bg-(--gray-a2) px-3 py-2.5"
                      >
                        <Flex align="center" gap="3" className="min-w-0">
                          <ProviderAvatar
                            providerId={state.selectedProviderId}
                            baseUrl={state.selectedProvider?.base_url ?? ""}
                            large
                            refreshToken={avatarRefreshToken}
                            overrideValue={selectedProviderAvatarOverride}
                          />
                          <Box className="min-w-0">
                            <Text size="2" weight="medium" className="truncate">
                              {state.selectedProvider?.label ?? "Provider"}
                            </Text>
                            <Text size="1" color="gray" className="truncate">
                              {getTemplateHost(
                                state.selectedProvider?.base_url ?? "",
                              )}
                            </Text>
                          </Box>
                        </Flex>
                        <Box className="w-[220px] max-w-full">
                          <TextField.Root
                            value={avatarSearch}
                            onChange={(e) => setAvatarSearch(e.target.value)}
                            placeholder="Search icons"
                          >
                            <TextField.Slot side="left">
                              <IconSearch size={14} />
                            </TextField.Slot>
                          </TextField.Root>
                        </Box>
                      </Flex>

                      <Box>
                        <Text size="1" weight="bold" color="gray">
                          Icons
                        </Text>
                        <ScrollArea
                          scrollbars="vertical"
                          className="mt-2 max-h-[260px] -mr-5"
                        >
                          <Box className="flex! flex-wrap gap-5! pr-5">
                            {orderedIconCatalog.map((entry) => {
                              return (
                                <Button
                                  variant="outline"
                                  key={entry.key}
                                  onClick={() =>
                                    void handleApplyCatalogAvatar(entry.key)
                                  }
                                >
                                  <img
                                    src={entry.asset}
                                    alt=""
                                    className="h-7 w-7 shrink-0 object-contain"
                                  />
                                </Button>
                              );
                            })}
                          </Box>
                        </ScrollArea>
                      </Box>

                      <Box className="rounded-xl border border-(--gray-a4) bg-(--gray-a2) px-3 py-3">
                        <Text size="1" weight="bold" color="gray">
                          Custom Source
                        </Text>
                        <Flex direction="column" gap="2.5" className="mt-2.5">
                          <Flex gap="2" align="center">
                            <TextField.Root
                              value={avatarUrlInput}
                              onChange={(e) =>
                                setAvatarUrlInput(e.target.value)
                              }
                              placeholder="https://example.com/logo.png"
                              className="flex-1"
                            />
                            <Button
                              variant="soft"
                              onClick={() =>
                                void handleApplyProviderAvatarUrl()
                              }
                              disabled={!avatarUrlInput.trim()}
                            >
                              Apply
                            </Button>
                          </Flex>

                          <Flex gap="2" wrap="wrap">
                            <Button
                              variant="soft"
                              color="gray"
                              onClick={() => void handleSelectProviderAvatar()}
                            >
                              <IconUpload size={14} />
                              Upload
                            </Button>
                            <Button
                              variant="soft"
                              color="gray"
                              onClick={() => void handleRefetchProviderAvatar()}
                            >
                              <IconRefresh size={14} />
                              Refetch
                            </Button>
                            <Button
                              variant="soft"
                              color="gray"
                              onClick={() => void handleResetProviderAvatar()}
                            >
                              <IconX size={14} />
                              Reset
                            </Button>
                          </Flex>
                        </Flex>
                      </Box>
                    </Box>
                  </Dialog.Content>
                </Dialog.Root>
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
                </Box>
              </Flex>
              <Flex align="center" gap="2">
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
              <Flex align="baseline" gap="2">
                <Text size="2" weight="medium" color="gray" className="shrink-0">
                  {t("settings.postProcessing.api.providers.fields.baseUrl")}
                </Text>
                <Text size="1" color="gray" className="opacity-50">
                  {t(
                    "settings.postProcessing.api.providers.fields.baseUrlHint",
                  )}
                </Text>
              </Flex>
              <TextField.Root
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                onBlur={() => state.handleBaseUrlChange(localBaseUrl)}
                placeholder="https://api.openai.com/v1"
                className="w-full"
              />
              {localBaseUrl.trim() && (
                <Box className="rounded-[var(--radius-2)] bg-(--gray-a2) border border-(--gray-a4) px-3 py-2 font-mono text-xs leading-relaxed overflow-x-auto">
                  <Text size="1" className="text-(--gray-9) select-none">
                    POST{" "}
                  </Text>
                  <Text size="1" className="text-(--accent-11) break-all">
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
                </Box>
              )}
            </Flex>

            {/* API Key */}
            <Flex direction="column" gap="2">
              <Flex align="baseline" gap="2">
                <Text size="2" weight="medium" color="gray" className="shrink-0">
                  {t("settings.postProcessing.api.providers.fields.apiKey")}
                </Text>
                {(() => {
                  const tpl = matchProviderTemplate(
                    state.selectedProviderId,
                    state.selectedProvider?.base_url,
                  );
                  if (!tpl?.signupUrl) return null;
                  return (
                    <Text
                      size="1"
                      className="inline-flex cursor-pointer items-center gap-0.5 text-(--accent-11) hover:underline"
                      onClick={() => openUrl(tpl.signupUrl!)}
                    >
                      {t(
                        "settings.postProcessing.api.providers.fields.getApiKey",
                      )}
                      <IconExternalLink size={12} />
                    </Text>
                  );
                })()}
              </Flex>
              <Flex align="center" gap="2">
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

            {/* Add Model */}
            <Button
              variant="soft"
              onClick={onOpenAddModel}
              disabled={!state.selectedProviderId}
            >
              <IconPlus size={14} />
              {t("settings.postProcessing.models.selectModel.addButton")}
            </Button>
          </Box>
        </Flex>
      </Grid>
    </Card>
  );
};
