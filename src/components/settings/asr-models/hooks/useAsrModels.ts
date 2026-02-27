// Custom hook for ASR model management state and actions

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../../hooks/useSettings";
import type { ModelInfo } from "../../../../lib/types";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../../../lib/utils/modelTranslation";
import { RECOMMENDED_MODEL_IDS } from "../constants";
import type { LanguageKey, ModeKey, StatusFilter, TypeKey } from "../types";
import { getModeKey, getTypeKey, orderMode, parseLanguageKeys } from "../utils";

export interface UseAsrModelsReturn {
  // Data
  models: ModelInfo[];
  filteredModels: ModelInfo[];
  groupsByMode: [ModeKey, ModelInfo[]][];
  favoriteSet: Set<string>;
  punctuationModels: ModelInfo[];
  punctuationModelOptions: {
    value: string;
    label: string;
    disabled: boolean;
  }[];
  selectedPunctuationModelId: string;

  // UI State
  busy: boolean;
  error: string | null;
  query: string;
  statusFilter: StatusFilter;
  modeFilter: Set<ModeKey>;
  languageFilter: Set<LanguageKey>;
  typeFilter: Set<TypeKey>;
  autoDownloadingPunctuation: boolean;

  // Dialog State
  isAddDialogOpen: boolean;
  editMode: boolean;
  url: string;
  addName: string;
  addTags: Set<string>;
  customTagInput: string;
  removeConfirmOpen: boolean;
  modelToRemove: string | null;

  // Setters
  setQuery: (value: string) => void;
  setStatusFilter: (value: StatusFilter) => void;
  setModeFilter: React.Dispatch<React.SetStateAction<Set<ModeKey>>>;
  setLanguageFilter: React.Dispatch<React.SetStateAction<Set<LanguageKey>>>;
  setTypeFilter: React.Dispatch<React.SetStateAction<Set<TypeKey>>>;
  setIsAddDialogOpen: (value: boolean) => void;
  setUrl: (value: string) => void;
  setAddName: (value: string) => void;
  setCustomTagInput: (value: string) => void;
  setRemoveConfirmOpen: (value: boolean) => void;

  // Actions
  refreshModels: () => Promise<void>;
  resetFilters: () => void;
  openAddDialog: () => void;
  openEditDialog: (model: ModelInfo) => void;
  openRemoveConfirm: (modelId: string) => void;
  confirmRemoveModel: () => Promise<void>;
  addFromUrl: () => Promise<void>;
  toggleAddTag: (tag: string) => void;
  addCustomTag: () => void;
  toggleFavorite: (modelId: string) => Promise<void>;
  deleteModelFiles: (modelId: string) => Promise<void>;
  downloadModel: (modelId: string) => Promise<void>;
}

export const useAsrModels = (): UseAsrModelsReturn => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  // Model list state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modeFilter, setModeFilter] = useState<Set<ModeKey>>(
    () => new Set(["streaming", "offline", "punctuation"]),
  );
  const [languageFilter, setLanguageFilter] = useState<Set<LanguageKey>>(
    () => new Set(),
  );
  const [typeFilter, setTypeFilter] = useState<Set<TypeKey>>(() => new Set());

  // Add/Edit dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [url, setUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [addTags, setAddTags] = useState<Set<string>>(() => new Set());
  const [customTagInput, setCustomTagInput] = useState("");

  // Remove confirmation state
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [modelToRemove, setModelToRemove] = useState<string | null>(null);

  // Computed values
  const favoriteSet = useMemo(
    () => new Set(settings?.favorite_transcription_models ?? []),
    [settings?.favorite_transcription_models],
  );

  // Punctuation models no longer supported without Sherpa
  const punctuationModels: typeof models = [];

  const selectedPunctuationModelId =
    settings?.punctuation_model ?? "punct-zh-en-ct-transformer-2024-04-12-int8";

  const punctuationModelOptions = useMemo(() => {
    return punctuationModels.map((m) => ({
      value: m.id,
      label: `${getTranslatedModelName(m, t)} · ${m.size_mb} MB`,
      disabled: false,
    }));
  }, [punctuationModels, t]);

  // Actions
  const refreshModels = useCallback(async () => {
    const list = await invoke<ModelInfo[]>("get_available_models");
    setModels(list);
  }, []);

  const resetFilters = useCallback(() => {
    setUrl("");
    setQuery("");
    setStatusFilter("all");
    setModeFilter(new Set(["streaming", "offline", "punctuation"]));
    setLanguageFilter(new Set());
    setTypeFilter(new Set());
    setError(null);
  }, []);

  // Auto-download punctuation model state
  const [autoDownloadingPunctuation, setAutoDownloadingPunctuation] =
    useState(false);

  // Check if any punctuation model is downloaded
  const hasPunctuationModelDownloaded = useMemo(() => {
    return punctuationModels.some((m) => m.is_downloaded);
  }, [punctuationModels]);

  // Auto-download smallest punctuation model if none is downloaded
  useEffect(() => {
    const autoDownload = async () => {
      // Only trigger if we have models loaded and none is downloaded
      if (
        punctuationModels.length > 0 &&
        !hasPunctuationModelDownloaded &&
        !autoDownloadingPunctuation &&
        !busy
      ) {
        // Find smallest punctuation model (already sorted by size)
        const smallest = punctuationModels[0];
        if (smallest) {
          setAutoDownloadingPunctuation(true);
          try {
            await invoke("download_model", { modelId: smallest.id });
            await refreshModels();
          } catch (err) {
            console.error("Auto-download punctuation model failed:", err);
          } finally {
            setAutoDownloadingPunctuation(false);
          }
        }
      }
    };
    autoDownload();
  }, [
    punctuationModels,
    hasPunctuationModelDownloaded,
    autoDownloadingPunctuation,
    busy,
    refreshModels,
  ]);

  // Filtered models
  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = models;

    // Status filter
    if (statusFilter === "downloaded") {
      list = list.filter((m) => m.is_downloaded);
    } else if (statusFilter === "favorites") {
      list = list.filter((m) => favoriteSet.has(m.id));
    } else if (statusFilter === "recommended") {
      list = list.filter((m) => RECOMMENDED_MODEL_IDS.has(m.id));
    }

    // Mode filter
    list = list.filter((m) => modeFilter.has(getModeKey(m)));

    // Language filter
    if (languageFilter.size > 0) {
      list = list.filter((m) => {
        const langs = parseLanguageKeys(m);
        const matchesSpecific = langs.some((l) => languageFilter.has(l));
        const matchesMultilingual =
          languageFilter.has("multilingual") && langs.includes("multilingual");
        return matchesSpecific || matchesMultilingual;
      });
    }

    // Type filter
    if (typeFilter.size > 0) {
      list = list.filter((m) => typeFilter.has(getTypeKey(m)));
    }

    // Text search
    if (!q) return list;

    return list.filter((m) => {
      const name = getTranslatedModelName(m, t).toLowerCase();
      const id = m.id.toLowerCase();
      const desc = getTranslatedModelDescription(m, t).toLowerCase();
      return name.includes(q) || id.includes(q) || desc.includes(q);
    });
  }, [
    favoriteSet,
    languageFilter,
    modeFilter,
    models,
    query,
    statusFilter,
    t,
    typeFilter,
  ]);

  // Groups by mode
  const groupsByMode = useMemo(() => {
    const groups = new Map<ModeKey, ModelInfo[]>();
    for (const m of filteredModels) {
      const k = getModeKey(m);
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }

    // Sort within groups
    for (const [k, list] of groups.entries()) {
      list.sort((a, b) => {
        const sizeA = a.size_mb ?? Number.POSITIVE_INFINITY;
        const sizeB = b.size_mb ?? Number.POSITIVE_INFINITY;
        if (sizeA !== sizeB) return sizeA - sizeB;
        return getTranslatedModelName(a, t).localeCompare(
          getTranslatedModelName(b, t),
        );
      });
      groups.set(k, list);
    }

    return Array.from(groups.entries()).sort(
      ([a], [b]) => orderMode(a) - orderMode(b),
    );
  }, [filteredModels, t]);

  const openAddDialog = useCallback(() => {
    setEditMode(false);
    setUrl("");
    setAddName("");
    setAddTags(new Set());
    setCustomTagInput("");
    setError(null);
    setIsAddDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((model: ModelInfo) => {
    setEditMode(true);
    setUrl(model.url || "");
    setAddName(model.name || "");
    setAddTags(new Set(model.tags || []));
    setCustomTagInput("");
    setError(null);
    setIsAddDialogOpen(true);
  }, []);

  const openRemoveConfirm = useCallback((modelId: string) => {
    setModelToRemove(modelId);
    setRemoveConfirmOpen(true);
  }, []);

  const confirmRemoveModel = useCallback(async () => {
    if (!modelToRemove) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("remove_custom_model", { modelId: modelToRemove });
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setRemoveConfirmOpen(false);
      setModelToRemove(null);
    }
  }, [modelToRemove, refreshModels]);

  const addFromUrl = useCallback(async () => {
    const value = url.trim();
    if (!value) return;

    setBusy(true);
    setError(null);
    try {
      await invoke<string>("add_model_from_url", {
        url: value,
        name: addName.trim() || null,
        tags: addTags.size > 0 ? Array.from(addTags) : null,
      });
      setIsAddDialogOpen(false);
      setUrl("");
      setAddName("");
      setAddTags(new Set());
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [url, addName, addTags, refreshModels]);

  const toggleAddTag = useCallback((tag: string) => {
    setAddTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const addCustomTag = useCallback(() => {
    const val = customTagInput.trim();
    if (val) {
      setAddTags((prev) => {
        const next = new Set(prev);
        next.add(val);
        return next;
      });
      setCustomTagInput("");
    }
  }, [customTagInput]);

  const toggleFavorite = useCallback(
    async (modelId: string) => {
      const current = new Set(settings?.favorite_transcription_models ?? []);
      if (current.has(modelId)) {
        current.delete(modelId);
      } else {
        current.add(modelId);
      }
      await updateSetting("favorite_transcription_models", Array.from(current));
    },
    [settings?.favorite_transcription_models, updateSetting],
  );

  const deleteModelFiles = useCallback(
    async (modelId: string) => {
      setBusy(true);
      setError(null);
      try {
        await invoke("delete_model", { modelId });
        await refreshModels();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refreshModels],
  );

  const downloadModel = useCallback(
    async (modelId: string) => {
      setBusy(true);
      setError(null);
      try {
        await invoke("download_model", { modelId });
        await refreshModels();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refreshModels],
  );

  // Initial load
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  return {
    // Data
    models,
    filteredModels,
    groupsByMode,
    favoriteSet,
    punctuationModels,
    punctuationModelOptions,
    selectedPunctuationModelId,

    // UI State
    busy,
    error,
    query,
    statusFilter,
    modeFilter,
    languageFilter,
    typeFilter,
    autoDownloadingPunctuation,

    // Dialog State
    isAddDialogOpen,
    editMode,
    url,
    addName,
    addTags,
    customTagInput,
    removeConfirmOpen,
    modelToRemove,

    // Setters
    setQuery,
    setStatusFilter,
    setModeFilter,
    setLanguageFilter,
    setTypeFilter,
    setIsAddDialogOpen,
    setUrl,
    setAddName,
    setCustomTagInput,
    setRemoveConfirmOpen,

    // Actions
    refreshModels,
    resetFilters,
    openAddDialog,
    openEditDialog,
    openRemoveConfirm,
    confirmRemoveModel,
    addFromUrl,
    toggleAddTag,
    addCustomTag,
    toggleFavorite,
    deleteModelFiles,
    downloadModel,
  };
};
