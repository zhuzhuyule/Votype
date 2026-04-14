import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  IconButton,
  Popover,
  ScrollArea,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconCheck,
  IconCpu,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconHexagonLetterA,
  IconLayoutGrid,
  IconPencil,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconRotate,
  IconSearch,
  IconServer,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSettings } from "../../../hooks/useSettings";
import { buildProviderTabsLayout } from "../../../lib/providerTabsLayout";
import type { KeyEntry } from "../../../lib/types";
import { Card } from "../../ui/Card";
import type { PostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
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

const PROVIDER_TAB_GAP = 4;
const PROVIDER_MORE_FALLBACK_WIDTH = 74;

function getOptionLabelText(label: string | React.ReactNode) {
  return typeof label === "string" ? label : "";
}

const PROVIDER_TAB_BUTTON_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-2)] border px-2.5 text-[12px] leading-none transition-[background-color,border-color,color,box-shadow] duration-150";

const PROVIDER_TAB_IDLE_CLASS =
  "border-(--gray-a4) bg-(--gray-a2) text-(--gray-11) shadow-sm hover:bg-(--gray-a3)";

const PROVIDER_TAB_ACTIVE_CLASS =
  "border-(--accent-a5) bg-(--accent-a3) text-(--accent-11) shadow-sm";

const ProviderAvatar: React.FC<{
  providerId: string;
  baseUrl: string;
  large?: boolean;
  compact?: boolean;
  refreshToken?: number;
  overrideValue?: string | null;
}> = ({
  providerId,
  baseUrl,
  large = false,
  compact = false,
  refreshToken = 0,
  overrideValue = null,
}) => {
  const staticAssetUrl = PROVIDER_BRAND_ASSETS[providerId] ?? null;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(staticAssetUrl);
  const Glyph = getProviderGlyph(providerId, baseUrl);
  const meta = getProviderMeta(providerId);
  const frameClass = large
    ? "h-10 w-10 rounded-xl"
    : compact
      ? "h-5.5 w-5.5 rounded-md bg-(--gray-a3) p-0.5"
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
          className="block h-6 w-6 shrink-0 object-contain"
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
        <Glyph
          size={compact ? 12 : 18}
          className="block opacity-90"
          strokeWidth={1.5}
        />
      </Box>
    ) : (
      <Box
        className={`inline-flex! shrink-0 items-center justify-center ${frameClass}`}
      >
        <Glyph
          size={compact ? 11 : 16}
          className="block opacity-90"
          strokeWidth={1.5}
        />
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
      className={`inline-flex shrink-0 items-center justify-center text-center leading-none font-semibold ${compact ? "text-[10px]" : "text-xs"} ${frameClass}`}
    >
      {meta.label}
    </Box>
  );
};

/** Multi-key list for a single provider. */
type ConnectionStatus = "idle" | "testing" | "success" | "error";

export interface ApiKeyListHandle {
  addKey: () => void;
}

const ApiKeyList = React.forwardRef<
  ApiKeyListHandle,
  {
    providerId: string;
    onKeysChanged?: () => void;
    onTestConnection?: () => Promise<{
      error?: string | null;
      result?: string;
    }>;
  }
>(({ providerId, onKeysChanged, onTestConnection }, ref) => {
  const { getPostProcessApiKeys, setPostProcessApiKeys } = useSettings();
  const { t } = useTranslation();
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});
  const [keyStatus, setKeyStatus] = useState<
    Record<number, { status: ConnectionStatus; message: string }>
  >({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<KeyEntry | null>(null);
  const loadedProviderRef = useRef<string | null>(null);
  const EMPTY_KEY_ENTRY: KeyEntry = { key: "", enabled: true, label: null };

  // Cleanup empty/dirty keys before switching provider
  const cleanupEditingRef = useRef<() => void>(() => {});
  cleanupEditingRef.current = () => {
    if (editingIndex === null) return;
    const entry = keys[editingIndex];
    if (!entry) return;
    if (!entry.key.trim()) {
      // Empty key: restore snapshot if it had content, otherwise delete
      if (editSnapshot?.key.trim()) {
        const restored = keys.map((k, i) =>
          i === editingIndex ? editSnapshot : k,
        );
        void persist(restored);
      } else {
        // New empty entry — remove it
        const cleaned = keys.filter((_, i) => i !== editingIndex);
        if (cleaned.length > 0) {
          void persist(cleaned);
        }
      }
    }
    setEditingIndex(null);
    setEditSnapshot(null);
  };

  // Load keys from backend when provider changes
  useEffect(() => {
    if (!providerId) return;
    // Cleanup previous provider's dirty state
    cleanupEditingRef.current();

    let cancelled = false;
    loadedProviderRef.current = providerId;
    getPostProcessApiKeys(providerId)
      .then((loaded) => {
        if (!cancelled && loadedProviderRef.current === providerId) {
          const normalizedKeys =
            loaded && loaded.length > 0 ? loaded : [EMPTY_KEY_ENTRY];
          setKeys(normalizedKeys);
          setShowKeys({});
          setKeyStatus({});
          // Auto-enter editing for any empty key
          const emptyIdx = normalizedKeys.findIndex((k) => !k.key.trim());
          if (emptyIdx >= 0) {
            setEditingIndex(emptyIdx);
            setEditSnapshot({ ...normalizedKeys[emptyIdx] });
          } else {
            setEditingIndex(null);
            setEditSnapshot(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKeys([EMPTY_KEY_ENTRY]);
          setEditingIndex(0);
          setEditSnapshot({ ...EMPTY_KEY_ENTRY });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, getPostProcessApiKeys]);

  const persist = useCallback(
    async (updated: KeyEntry[]) => {
      setKeys(updated);
      await setPostProcessApiKeys(providerId, updated);
      onKeysChanged?.();
    },
    [providerId, setPostProcessApiKeys, onKeysChanged],
  );

  const handleAddKey = useCallback(() => {
    const newEntry: KeyEntry = { key: "", enabled: true, label: null };
    // If currently editing an empty key, remove it first
    let base = keys;
    if (editingIndex !== null) {
      const current = keys[editingIndex];
      if (current && !current.key.trim()) {
        // Empty — remove it (or restore snapshot if had content)
        if (editSnapshot?.key.trim()) {
          base = keys.map((k, i) => (i === editingIndex ? editSnapshot : k));
        } else {
          base = keys.filter((_, i) => i !== editingIndex);
        }
      } else if (current) {
        // Has content — persist it
        void persist(keys);
      }
    }
    const updated = [...base, newEntry];
    setKeys(updated);
    setEditingIndex(updated.length - 1);
    setEditSnapshot({ ...newEntry });
  }, [keys, editingIndex, editSnapshot, persist]);

  React.useImperativeHandle(ref, () => ({ addKey: handleAddKey }), [
    handleAddKey,
  ]);

  const handleKeyChange = useCallback(
    (index: number, value: string) => {
      const updated = keys.map((k, i) =>
        i === index ? { ...k, key: value } : k,
      );
      setKeys(updated);
    },
    [keys],
  );

  const handleKeyBlur = useCallback(
    (index: number) => {
      // Persist on blur, remove empty entries that are not the only one
      const filtered = keys.filter(
        (k, i) => i === index || k.key.trim() !== "" || keys.length === 1,
      );
      void persist(filtered);
    },
    [keys, persist],
  );

  const handleLabelChange = useCallback(
    (index: number, value: string) => {
      const updated = keys.map((k, i) =>
        i === index ? { ...k, label: value || null } : k,
      );
      setKeys(updated);
    },
    [keys],
  );

  const handleLabelBlur = useCallback(() => {
    void persist(keys);
  }, [keys, persist]);

  const handleToggle = useCallback(
    (index: number) => {
      const updated = keys.map((k, i) =>
        i === index ? { ...k, enabled: !k.enabled } : k,
      );
      void persist(updated);
    },
    [keys, persist],
  );

  const handleDelete = useCallback(
    (index: number) => {
      if (keys.length <= 1) {
        // Last item: clear content but keep the entry, stay in editing
        const cleared: KeyEntry = { key: "", enabled: true, label: null };
        void persist([cleared]);
        setEditingIndex(0);
        setEditSnapshot({ ...cleared });
        setKeyStatus({});
      } else {
        const updated = keys.filter((_, i) => i !== index);
        void persist(updated);
        setEditingIndex(null);
        // Shift statuses after deletion
        setKeyStatus((prev) => {
          const next: typeof prev = {};
          for (const [k, v] of Object.entries(prev)) {
            const ki = Number(k);
            if (ki < index) next[ki] = v;
            else if (ki > index) next[ki - 1] = v;
          }
          return next;
        });
      }
    },
    [keys, persist],
  );

  const toggleShowKey = useCallback((index: number) => {
    setShowKeys((prev) => ({ ...prev, [index]: !prev[index] }));
  }, []);

  const maskKey = (key: string) => {
    if (!key) return "";
    if (key.length <= 8) return key.slice(0, 3) + "…";
    return key.slice(0, 6) + "…" + key.slice(-4);
  };

  const formatKeyDisplay = (entry: KeyEntry) => {
    const parts: string[] = [];
    if (entry.label) parts.push(entry.label);
    if (entry.key) parts.push(maskKey(entry.key));
    return parts.join(" · ") || "";
  };

  const handleTestKey = useCallback(
    async (index: number) => {
      if (!onTestConnection) return;
      const current = keyStatus[index];
      if (current?.status === "testing") return;

      setKeyStatus((prev) => ({
        ...prev,
        [index]: { status: "testing", message: "" },
      }));

      try {
        const res = await onTestConnection();
        if (res.error) {
          setKeyStatus((prev) => ({
            ...prev,
            [index]: { status: "error", message: res.error ?? "" },
          }));
          toast.error(res.error);
        } else {
          setKeyStatus((prev) => ({
            ...prev,
            [index]: { status: "success", message: res.result ?? "OK" },
          }));
          toast.success(
            t("settings.postProcessing.api.providers.api.testSuccess", {
              result: res.result ?? "OK",
            }),
          );
        }
      } catch (e) {
        const msg = String(e);
        setKeyStatus((prev) => ({
          ...prev,
          [index]: { status: "error", message: msg },
        }));
        toast.error(msg);
      }
    },
    [onTestConnection, keyStatus, t],
  );

  const getDotProps = (index: number) => {
    const s = keyStatus[index]?.status ?? "idle";
    const msg = keyStatus[index]?.message ?? "";
    const color =
      s === "success"
        ? "bg-green-500"
        : s === "error"
          ? "bg-red-500"
          : s === "testing"
            ? "bg-yellow-500 animate-pulse"
            : "bg-(--gray-7)";
    const title =
      s === "success"
        ? msg || "Connected"
        : s === "error"
          ? msg || "Connection failed"
          : s === "testing"
            ? "Testing…"
            : "Click to test";
    return { color, title };
  };

  const startEditing = (index: number) => {
    setEditSnapshot({ ...keys[index] });
    setEditingIndex(index);
  };

  const confirmEditing = (index: number) => {
    const entry = keys[index];
    if (!entry) return;

    if (!entry.key.trim()) {
      if (keys.length <= 1) {
        setEditingIndex(index);
        setEditSnapshot({ ...EMPTY_KEY_ENTRY });
        return;
      }

      const cleaned = keys.filter((_, i) => i !== index);
      void persist(cleaned);
      setEditingIndex(null);
      setEditSnapshot(null);
      return;
    }

    handleKeyBlur(index);
    setEditingIndex(null);
    setEditSnapshot(null);
  };

  const cancelEditing = (index: number) => {
    if (editSnapshot) {
      if (!editSnapshot.key.trim()) {
        if (keys.length <= 1) {
          setEditingIndex(index);
          setEditSnapshot({ ...EMPTY_KEY_ENTRY });
          return;
        }

        const cleaned = keys.filter((_, i) => i !== index);
        void persist(cleaned);
        setEditingIndex(null);
        setEditSnapshot(null);
        return;
      }
      // Restore snapshot
      const updated = keys.map((k, i) => (i === index ? editSnapshot : k));
      setKeys(updated);
    }
    setEditingIndex(null);
    setEditSnapshot(null);
  };

  // Empty: show placeholder
  if (keys.length === 0) {
    return (
      <Flex align="center" gap="3" className="h-8 min-w-0">
        <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-(--gray-7)" />
        <Text size="2" className="flex-1 min-w-0 opacity-40">
          —
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="1">
      {keys.map((entry, index) => {
        // Empty key always stays in editing mode
        const isEditing =
          editingIndex === index ||
          (!entry.key.trim() && editingIndex === null);
        const labelPlaceholder = entry.key ? maskKey(entry.key) : "Label";

        // Every row: [●] [label] [key/display] [actions...]
        const dot = getDotProps(index);
        return (
          <Flex key={index} align="center" gap="2" className="h-8">
            {/* 1. Status dot - always visible, per-key */}
            <button
              type="button"
              className={`shrink-0 h-2.5 w-2.5 rounded-full cursor-pointer transition-colors ${dot.color}`}
              title={dot.title}
              onClick={() => handleTestKey(index)}
            />

            {isEditing ? (
              <>
                {/* 2. Label input */}
                <TextField.Root
                  value={entry.label ?? ""}
                  onChange={(e) => handleLabelChange(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmEditing(index);
                    else if (e.key === "Escape") cancelEditing(index);
                  }}
                  placeholder={labelPlaceholder}
                  className="w-24 shrink-0"
                />
                {/* 3. Key input */}
                <TextField.Root
                  type={showKeys[index] ? "text" : "password"}
                  value={entry.key}
                  onChange={(e) => handleKeyChange(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmEditing(index);
                    else if (e.key === "Escape") cancelEditing(index);
                  }}
                  placeholder="sk-..."
                  className="flex-1"
                  autoFocus
                >
                  <TextField.Slot side="right">
                    <IconButton
                      size="1"
                      variant="ghost"
                      onClick={() => toggleShowKey(index)}
                      type="button"
                      color="gray"
                    >
                      {showKeys[index] ? (
                        <IconEyeOff height={14} width={14} />
                      ) : (
                        <IconEye height={14} width={14} />
                      )}
                    </IconButton>
                  </TextField.Slot>
                </TextField.Root>
                {/* Actions */}
                <Flex gap="3" className="ml-1 shrink-0">
                  <IconButton
                    size="2"
                    variant="ghost"
                    color="green"
                    onClick={() => confirmEditing(index)}
                    disabled={!entry.key.trim() && keys.length <= 1}
                    className="cursor-pointer"
                  >
                    <IconCheck size={16} />
                  </IconButton>
                  {editSnapshot?.key.trim() && (
                    <IconButton
                      size="2"
                      variant="ghost"
                      color="gray"
                      onClick={() => cancelEditing(index)}
                      className="cursor-pointer"
                    >
                      <IconX size={16} />
                    </IconButton>
                  )}
                  {(editSnapshot?.key.trim() || keys.length > 1) && (
                    <Popover.Root>
                      <Popover.Trigger>
                        <IconButton
                          size="2"
                          variant="ghost"
                          color="red"
                          className="cursor-pointer"
                        >
                          <IconTrash size={16} />
                        </IconButton>
                      </Popover.Trigger>
                      <Popover.Content size="1" side="bottom" align="end">
                        <Flex gap="2">
                          <Popover.Close>
                            <Button
                              size="1"
                              color="red"
                              variant="soft"
                              onClick={() => handleDelete(index)}
                              className="cursor-pointer"
                            >
                              {t("common.delete")}
                            </Button>
                          </Popover.Close>
                          <Popover.Close>
                            <Button
                              size="1"
                              variant="soft"
                              color="gray"
                              className="cursor-pointer"
                            >
                              {t("common.cancel")}
                            </Button>
                          </Popover.Close>
                        </Flex>
                      </Popover.Content>
                    </Popover.Root>
                  )}
                </Flex>
              </>
            ) : (
              <>
                {/* 2+3. Label · masked key display */}
                <Text
                  size="2"
                  className={`flex-1 min-w-0 truncate ${entry.enabled ? "text-(--gray-11)" : "text-(--gray-8) line-through"}`}
                  title={formatKeyDisplay(entry)}
                >
                  {formatKeyDisplay(entry)}
                </Text>
                {/* Toggle enable/disable */}
                <Switch
                  size="1"
                  checked={entry.enabled}
                  onCheckedChange={() => handleToggle(index)}
                  className="shrink-0"
                />
                {/* Edit button */}
                <IconButton
                  size="2"
                  variant="ghost"
                  color="gray"
                  onClick={() => startEditing(index)}
                  className="cursor-pointer shrink-0"
                >
                  <IconPencil size={16} />
                </IconButton>
              </>
            )}
          </Flex>
        );
      })}
    </Flex>
  );
});

export const ApiSettings: React.FC<ApiSettingsProps> = ({
  isFetchingModels,
  providerState: state,
  onOpenAddModel,
}) => {
  const { t } = useTranslation();
  const {
    settings,
    updateCustomProvider,
    removeCustomProvider,
    addCustomProvider,
    reorderPostProcessProviders,
    refreshSettings,
  } = useSettings();

  const apiKeyListRef = useRef<ApiKeyListHandle>(null);
  const [localBaseUrl, setLocalBaseUrl] = useState(state.baseUrl);
  const [editingBaseUrl, setEditingBaseUrl] = useState(false);
  const [editingName, setEditingName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [avatarRefreshToken, setAvatarRefreshToken] = useState(0);
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [avatarSearch, setAvatarSearch] = useState("");
  const [draggingProviderId, setDraggingProviderId] = useState<string | null>(
    null,
  );

  const selectedProviderLabel = state.selectedProvider?.label ?? "";

  const visibleProviders = useMemo(() => {
    return state.providers.filter((provider) => {
      if (!provider.builtin) return true;
      if (provider.id === state.selectedProviderId) return true;

      const apiKeysVal = state.apiKeys?.[provider.id];
      const hasApiKey = Array.isArray(apiKeysVal)
        ? apiKeysVal.some((e: any) => e.enabled && e.key?.trim())
        : typeof apiKeysVal === "string"
          ? !!apiKeysVal.trim()
          : false;
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
      {
        key: "recommended",
        label: t("settings.postProcessing.api.providers.group.recommended"),
        templates: recommended,
      },
      {
        key: "cloud",
        label: t("settings.postProcessing.api.providers.group.cloud"),
        templates: cloud,
      },
      {
        key: "local",
        label: t("settings.postProcessing.api.providers.group.local"),
        templates: local,
      },
    ].filter((g) => g.templates.length > 0);
  }, [t]);

  const customProviderTemplate = useMemo(
    () => PROVIDER_TEMPLATES.find((template) => template.id === "custom"),
    [],
  );

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
    setEditingBaseUrl(false);

    const option = state.providerOptions.find(
      (p) => p.value === state.selectedProviderId,
    );
    if (option) {
      setEditingName(option.label as string);
    }
  }, [state.baseUrl, state.selectedProviderId, state.providerOptions]);

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

  const handleAddCustomProvider = async () => {
    if (customProviderTemplate == null) return;
    await handleAddProvider(customProviderTemplate);
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

  const reorderProviderTabs = useCallback(
    async (fromProviderId: string, toProviderId: string) => {
      if (fromProviderId === toProviderId) return;

      const currentOrder = (settings?.post_process_providers ?? []).map(
        (provider) => provider.id,
      );
      const fromIndex = currentOrder.indexOf(fromProviderId);
      const toIndex = currentOrder.indexOf(toProviderId);

      if (fromIndex === -1 || toIndex === -1) return;

      const nextOrder = [...currentOrder];
      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);
      await reorderPostProcessProviders(nextOrder);
    },
    [reorderPostProcessProviders, settings?.post_process_providers],
  );

  const tabsRailRef = useRef<HTMLDivElement | null>(null);
  const moreMeasureRef = useRef<HTMLButtonElement | null>(null);
  const tabMeasureRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabsRailWidth, setTabsRailWidth] = useState(0);
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({});
  const [moreWidth, setMoreWidth] = useState(PROVIDER_MORE_FALLBACK_WIDTH);

  useLayoutEffect(() => {
    const measure = () => {
      setTabsRailWidth(tabsRailRef.current?.getBoundingClientRect().width ?? 0);

      const nextWidths: Record<string, number> = {};
      for (const option of sortedOptions) {
        const width =
          tabMeasureRefs.current[option.value]?.getBoundingClientRect().width ??
          0;
        nextWidths[option.value] = width + PROVIDER_TAB_GAP;
      }
      setTabWidths(nextWidths);
      setMoreWidth(
        (moreMeasureRef.current?.getBoundingClientRect().width ??
          PROVIDER_MORE_FALLBACK_WIDTH) + PROVIDER_TAB_GAP,
      );
    };

    measure();

    const observer = new ResizeObserver(() => measure());
    if (tabsRailRef.current) {
      observer.observe(tabsRailRef.current);
    }
    if (moreMeasureRef.current) {
      observer.observe(moreMeasureRef.current);
    }
    for (const node of Object.values(tabMeasureRefs.current)) {
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [sortedOptions, avatarRefreshToken]);

  const { visible: visibleTabs, overflow: overflowTabs } = useMemo(
    () =>
      buildProviderTabsLayout(
        sortedOptions.map((option) => ({
          value: option.value,
          label: getOptionLabelText(option.label),
        })),
        state.selectedProviderId,
        tabWidths,
        tabsRailWidth,
        moreWidth,
      ),
    [
      moreWidth,
      sortedOptions,
      state.selectedProviderId,
      tabWidths,
      tabsRailWidth,
    ],
  );

  return (
    <Card className="p-0! overflow-hidden">
      <Flex direction="column" className="min-h-[520px]">
        <Flex
          align="center"
          justify="between"
          gap="3"
          className="shrink-0 border-b border-gray-100 px-4 py-2 dark:border-gray-800"
        >
          <Flex align="center" gap="3" className="min-w-0 flex-1">
            <Text size="3" weight="bold" className="shrink-0">
              {t("settings.postProcessing.api.provider.title")}
            </Text>
            <Box ref={tabsRailRef} className="min-w-0 flex-1">
              <Flex
                align="center"
                gap="1"
                wrap="nowrap"
                className="min-w-0 overflow-hidden"
              >
                {visibleTabs.map((option) => {
                  const isSelected = state.selectedProviderId === option.value;
                  const provider = state.providers.find(
                    (item) => item.id === option.value,
                  );
                  return (
                    <button
                      key={option.value}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", option.value);
                        setDraggingProviderId(option.value);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const fromProviderId =
                          event.dataTransfer.getData("text/plain") ||
                          draggingProviderId;
                        if (!fromProviderId) return;
                        void reorderProviderTabs(fromProviderId, option.value);
                        setDraggingProviderId(null);
                      }}
                      onDragEnd={() => setDraggingProviderId(null)}
                      onClick={() => state.handleProviderSelect(option.value)}
                      className={`${PROVIDER_TAB_BUTTON_CLASS} ${
                        isSelected
                          ? PROVIDER_TAB_ACTIVE_CLASS
                          : PROVIDER_TAB_IDLE_CLASS
                      } ${draggingProviderId === option.value ? "opacity-65" : ""}`}
                    >
                      <ProviderAvatar
                        providerId={option.value}
                        baseUrl={provider?.base_url ?? ""}
                        compact
                        refreshToken={avatarRefreshToken}
                        overrideValue={
                          settings?.post_process_provider_avatar_overrides?.[
                            option.value
                          ] ?? null
                        }
                      />
                      <Text size="1" className="whitespace-nowrap">
                        {option.label}
                      </Text>
                    </button>
                  );
                })}

                {overflowTabs.length > 0 && (
                  <Popover.Root>
                  <Popover.Trigger>
                    <button
                      type="button"
                      className={`${PROVIDER_TAB_BUTTON_CLASS} ${PROVIDER_TAB_IDLE_CLASS}`}
                    >
                      <Text size="1">更多</Text>
                        <Text size="1" color="gray" className="tabular-nums">
                          {overflowTabs.length}
                        </Text>
                      </button>
                    </Popover.Trigger>
                    <Popover.Content size="1" side="bottom" align="start">
                      <Flex direction="column" gap="1" className="min-w-[220px]">
                        {overflowTabs.map((option) => {
                          const provider = state.providers.find(
                            (item) => item.id === option.value,
                          );
                          return (
                            <Popover.Close key={option.value}>
                              <button
                                type="button"
                                onClick={() =>
                                  state.handleProviderSelect(option.value)
                                }
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-(--gray-a2)"
                              >
                                <ProviderAvatar
                                  providerId={option.value}
                                  baseUrl={provider?.base_url ?? ""}
                                  compact
                                  refreshToken={avatarRefreshToken}
                                  overrideValue={
                                    settings
                                      ?.post_process_provider_avatar_overrides?.[
                                      option.value
                                    ] ?? null
                                  }
                                />
                                <Text size="2" className="truncate">
                                  {option.label}
                                </Text>
                              </button>
                            </Popover.Close>
                          );
                        })}
                      </Flex>
                    </Popover.Content>
                  </Popover.Root>
                )}
              </Flex>
            </Box>
          </Flex>
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
              <Flex align="center" justify="between" className="pr-4">
                <Dialog.Title>
                  {t("settings.postProcessing.api.providers.add")}
                </Dialog.Title>
                <Button
                  size="1"
                  variant="soft"
                  className="cursor-pointer"
                  onClick={() => void handleAddCustomProvider()}
                  disabled={customProviderTemplate == null}
                >
                  {t(
                    "settings.postProcessing.api.providers.addCustom",
                    "Add Custom",
                  )}
                </Button>
              </Flex>
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
                              onClick={() => void handleAddProvider(template)}
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
                                            void openUrl(template.signupUrl!);
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
                    ))}
                  </Flex>
                </ScrollArea>
              </Box>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>

        <Box
          aria-hidden="true"
          className="pointer-events-none fixed top-[-10000px] left-[-10000px] opacity-0"
        >
          <Flex align="center" gap="1" wrap="nowrap">
            {sortedOptions.map((option) => {
              const provider = state.providers.find(
                (item) => item.id === option.value,
              );
              return (
                <button
                  key={`measure-${option.value}`}
                  type="button"
                  ref={(node) => {
                    tabMeasureRefs.current[option.value] = node;
                  }}
                  className={`${PROVIDER_TAB_BUTTON_CLASS} ${PROVIDER_TAB_IDLE_CLASS}`}
                >
                  <ProviderAvatar
                    providerId={option.value}
                    baseUrl={provider?.base_url ?? ""}
                    compact
                    refreshToken={avatarRefreshToken}
                    overrideValue={
                      settings?.post_process_provider_avatar_overrides?.[
                        option.value
                      ] ?? null
                    }
                  />
                  <Text size="1" className="whitespace-nowrap">
                    {option.label}
                  </Text>
                </button>
              );
            })}
            <button
              ref={moreMeasureRef}
              type="button"
              className={`${PROVIDER_TAB_BUTTON_CLASS} ${PROVIDER_TAB_IDLE_CLASS}`}
            >
              <Text size="1">更多</Text>
              <Text size="1" color="gray" className="tabular-nums">
                99
              </Text>
            </button>
          </Flex>
        </Box>

        <Flex direction="column" className="min-h-0 flex-1 overflow-hidden">
          {/* Header */}
          <Box className="pt-4 px-8 pb-1 shrink-0">
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
                <TextField.Root
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={handleNameBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      setEditingName(selectedProviderLabel);
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder={t(
                    "settings.postProcessing.api.provider.namePlaceholder",
                  )}
                  className="w-60 shrink-0 font-medium"
                />
                {(() => {
                  const tpl = matchProviderTemplate(
                    state.selectedProviderId,
                    state.selectedProvider?.base_url,
                  );
                  if (!tpl?.signupUrl) return null;
                  return (
                    <Text
                      size="1"
                      className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 text-(--accent-11) hover:underline"
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
          <Box className="px-8 py-4 flex-1 overflow-y-auto">
            {/* Grid: label right-aligned | value left-aligned */}
            <Grid columns="auto 1fr" gapX="4" gapY="2" align="center">
              {/* Base URL */}
              <Text
                size="2"
                weight="medium"
                color="gray"
                className="text-right select-none"
              >
                {t("settings.postProcessing.api.providers.fields.baseUrl")}:
              </Text>
              {(() => {
                const tpl = matchProviderTemplate(
                  state.selectedProviderId,
                  state.selectedProvider?.base_url,
                );
                const defaultUrl = tpl?.baseUrl ?? "";
                // vs template default
                const isDiffFromDefault =
                  !!defaultUrl && localBaseUrl !== defaultUrl;
                // vs value before editing
                const isDiffFromSaved = localBaseUrl !== state.baseUrl;

                const saveBaseUrl = () => {
                  state.handleBaseUrlChange(localBaseUrl);
                  setEditingBaseUrl(false);
                };
                const cancelBaseUrl = () => {
                  setLocalBaseUrl(state.baseUrl);
                  setEditingBaseUrl(false);
                };
                const resetBaseUrl = () => {
                  setLocalBaseUrl(defaultUrl);
                  state.handleBaseUrlChange(defaultUrl);
                  setEditingBaseUrl(false);
                };

                const isBaseUrlEditing = editingBaseUrl || !localBaseUrl.trim();

                return (
                  <Flex align="center" gap="2" className="h-8 min-w-0">
                    {isBaseUrlEditing ? (
                      <TextField.Root
                        value={localBaseUrl}
                        onChange={(e) => setLocalBaseUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveBaseUrl();
                          else if (e.key === "Escape") cancelBaseUrl();
                        }}
                        placeholder="https://api.openai.com/v1"
                        className="flex-1"
                        autoFocus
                      />
                    ) : (
                      <Text
                        size="2"
                        className="flex-1 min-w-0 truncate text-(--gray-11) leading-8"
                        title={localBaseUrl}
                      >
                        {localBaseUrl || <span className="opacity-40">—</span>}
                      </Text>
                    )}
                    <Flex gap="3" className="shrink-0">
                      {isBaseUrlEditing ? (
                        <>
                          <IconButton
                            size="2"
                            variant="ghost"
                            color="green"
                            onClick={saveBaseUrl}
                            disabled={!isDiffFromSaved}
                            className="cursor-pointer"
                          >
                            <IconCheck size={16} />
                          </IconButton>
                          <IconButton
                            size="2"
                            variant="ghost"
                            color="gray"
                            onClick={cancelBaseUrl}
                            disabled={!isDiffFromSaved}
                            className="cursor-pointer"
                          >
                            <IconX size={16} />
                          </IconButton>
                          {isDiffFromDefault && (
                            <IconButton
                              size="2"
                              variant="ghost"
                              color="orange"
                              onClick={resetBaseUrl}
                              title={t(
                                "settings.postProcessing.api.providers.resetUrl",
                              )}
                              className="cursor-pointer"
                            >
                              <IconRotate size={16} />
                            </IconButton>
                          )}
                        </>
                      ) : (
                        <IconButton
                          size="2"
                          variant="ghost"
                          color="gray"
                          onClick={() => setEditingBaseUrl(true)}
                          className="cursor-pointer"
                        >
                          <IconPencil size={16} />
                        </IconButton>
                      )}
                    </Flex>
                  </Flex>
                );
              })()}

              {/* API Keys */}
              <Text
                size="2"
                weight="medium"
                color="gray"
                className="self-start text-right select-none h-8 leading-8"
              >
                {t("settings.postProcessing.api.providers.fields.apiKey")}:
              </Text>
              <ApiKeyList
                ref={apiKeyListRef}
                providerId={state.selectedProviderId}
                onKeysChanged={() => {
                  void state.handleRefreshModels();
                }}
                onTestConnection={async () => {
                  const error = await state.testConnection();
                  return { error: error ?? null, result: "OK" };
                }}
              />
            </Grid>

            {/* Actions - outside grid */}
            <Flex align="center" gap="3" className="mt-4">
              <Button
                variant="soft"
                onClick={onOpenAddModel}
                disabled={!state.selectedProviderId}
              >
                <IconPlus size={14} />
                {t("settings.postProcessing.models.selectModel.addButton")}
              </Button>
              <Button
                variant="outline"
                onClick={() => apiKeyListRef.current?.addKey()}
              >
                <IconPlus size={14} />
                {t(
                  "settings.postProcessing.api.providers.fields.addKey",
                  "Add Key",
                )}
              </Button>
            </Flex>
          </Box>
        </Flex>
      </Flex>
    </Card>
  );
};
