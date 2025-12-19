// Custom hook for prompt management state and actions

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "../../../../../hooks/useSettings";
import type { LLMPrompt } from "../../../../../lib/types";

export interface UsePromptsReturn {
  // Settings
  enabled: boolean;
  prompts: LLMPrompt[];
  activePromptId: string | null | undefined;

  // Tab state
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  isCreating: boolean;
  viewingPrompt: LLMPrompt | null;

  // Draft state
  draftName: string;
  setDraftName: (value: string) => void;
  draftContent: string;
  setDraftContent: (value: string) => void;
  draftAlias: string;
  setDraftAlias: (value: string) => void;
  draftModelId: string | null;
  setDraftModelId: (value: string | null) => void;
  draftIcon: string | null;
  setDraftIcon: (value: string | null) => void;
  currentAliases: string[];
  currentAliasInput: string;
  setCurrentAliasInput: (value: string) => void;
  aliasError: string | null;
  setAliasError: (error: string | null) => void;

  // Prefix state
  prefixes: string;
  currentPrefixes: string[];
  currentPrefixInput: string;
  setCurrentPrefixInput: (value: string) => void;

  // Computed
  isDirty: boolean;
  textModels: { value: string; label: string }[];

  // Actions
  handleAddAlias: () => void;
  handleRemoveAlias: (alias: string) => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleSetAsActive: () => void;
  handleAddPrefix: () => void;
  handleRemovePrefix: (prefix: string) => void;
}

export const usePrompts = (): UsePromptsReturn => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, refreshSettings, settings } =
    useSettings();

  // Settings
  const enabled = getSetting("post_process_enabled") || false;
  const prompts = getSetting("post_process_prompts") || [];
  const activePromptId = getSetting("post_process_selected_prompt_id");

  // Tab state
  const [currentTab, setCurrentTab] = useState<string>(
    activePromptId || prompts[0]?.id || "NEW",
  );

  // Draft state
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftAlias, setDraftAlias] = useState("");
  const [draftModelId, setDraftModelId] = useState<string | null>(null);
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [currentAliasInput, setCurrentAliasInput] = useState("");

  // Prefix state
  const [prefixes, setPrefixes] = useState("");
  const [currentPrefixInput, setCurrentPrefixInput] = useState("");
  const lastLoadedPrefixesRef = useRef<string | null>(null);

  // Derived values
  const isCreating = currentTab === "NEW";
  const viewingPrompt = useMemo(
    () => prompts.find((p) => p.id === currentTab) || null,
    [prompts, currentTab],
  );

  const currentAliases = useMemo(() => {
    return draftAlias
      .split(/[,，]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }, [draftAlias]);

  const currentPrefixes = useMemo(() => {
    return prefixes
      .split(/[,，]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }, [prefixes]);

  const isDirty = useMemo(() => {
    if (isCreating) return true;
    if (!viewingPrompt) return false;
    return (
      draftName !== viewingPrompt.name ||
      draftContent !== viewingPrompt.prompt ||
      draftAlias !== (viewingPrompt.alias || "") ||
      (draftModelId || null) !== (viewingPrompt.model_id || null) ||
      (draftIcon || null) !== (viewingPrompt.icon || null)
    );
  }, [
    isCreating,
    viewingPrompt,
    draftName,
    draftContent,
    draftAlias,
    draftModelId,
    draftIcon,
  ]);

  // Text models for dropdown
  const cachedModels = settings?.cached_models || [];
  const textModels = useMemo(() => {
    const globalDefaultId = settings?.selected_prompt_model_id;
    const globalDefaultModel = globalDefaultId
      ? cachedModels.find((m) => m.id === globalDefaultId)
      : null;

    let defaultLabel = t("common.default");
    if (globalDefaultModel) {
      defaultLabel += ` (${globalDefaultModel.custom_label || globalDefaultModel.name})`;
    }

    const options = cachedModels
      .filter((model) => model.model_type === "text")
      .map((model) => {
        const provider = settings?.post_process_providers.find(
          (p) => p.id === model.provider_id,
        );
        const providerLabel = provider ? provider.label : model.provider_id;
        return {
          value: model.id,
          label: `${model.custom_label || model.name} (${providerLabel})`,
        };
      });
    return [{ value: "default", label: defaultLabel }, ...options];
  }, [
    cachedModels,
    settings?.post_process_providers,
    settings?.selected_prompt_model_id,
    t,
  ]);

  // Sync tab changes
  const lastLoadedTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentTab === "NEW") {
      if (lastLoadedTabRef.current !== "NEW") {
        setDraftName(t("settings.postProcessing.prompts.newPromptName"));
        setDraftContent("");
        setDraftAlias("");
        setDraftModelId(null);
        setDraftIcon(null);
        setAliasError(null);
        lastLoadedTabRef.current = "NEW";
      }
      return;
    }

    if (viewingPrompt && viewingPrompt.id !== lastLoadedTabRef.current) {
      setDraftName(viewingPrompt.name);
      setDraftContent(viewingPrompt.prompt);
      setDraftAlias(viewingPrompt.alias || "");
      setDraftModelId(viewingPrompt.model_id || null);
      setDraftIcon(viewingPrompt.icon || null);
      setAliasError(null);
      lastLoadedTabRef.current = viewingPrompt.id;
    }

    if (!viewingPrompt && currentTab !== "NEW" && prompts.length > 0) {
      setCurrentTab(prompts[0].id);
    } else if (!viewingPrompt && currentTab !== "NEW" && prompts.length === 0) {
      setCurrentTab("NEW");
    }
  }, [currentTab, viewingPrompt, t, prompts]);

  // Sync prefixes from settings
  useEffect(() => {
    const backendPrefixes = settings?.command_prefixes || "";
    if (backendPrefixes !== lastLoadedPrefixesRef.current) {
      setPrefixes(backendPrefixes);
      lastLoadedPrefixesRef.current = backendPrefixes;
    }
  }, [settings?.command_prefixes]);

  // Validation
  const validateAliases = useCallback(
    (inputAliases: string, currentPromptId: string | "NEW"): string | null => {
      if (!inputAliases.trim()) return null;

      const newAliases = inputAliases
        .split(/[,，]/)
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.length > 0);

      for (const prompt of prompts) {
        if (prompt.id === currentPromptId) continue;

        const existingAliases = (prompt.alias || "")
          .split(/[,，]/)
          .map((a) => a.trim().toLowerCase())
          .filter((a) => a.length > 0);

        const existingName = prompt.name.trim().toLowerCase();
        if (existingName) {
          existingAliases.push(existingName);
        }

        for (const newAlias of newAliases) {
          if (existingAliases.includes(newAlias)) {
            return t("settings.postProcessing.prompts.aliasDuplicate", {
              alias: newAlias,
              promptName: prompt.name,
            });
          }
        }
      }
      return null;
    },
    [prompts, t],
  );

  // Actions
  const handleAddAlias = useCallback(() => {
    const val = currentAliasInput.trim();
    if (!val) return;

    if (currentAliases.some((a) => a.toLowerCase() === val.toLowerCase())) {
      setCurrentAliasInput("");
      return;
    }

    const error = validateAliases(
      val,
      isCreating ? "NEW" : viewingPrompt?.id || "",
    );
    if (error) {
      setAliasError(error);
      return;
    }

    const newAliasList = [...currentAliases, val];
    setDraftAlias(newAliasList.join(","));
    setCurrentAliasInput("");
    setAliasError(null);
  }, [
    currentAliasInput,
    currentAliases,
    isCreating,
    validateAliases,
    viewingPrompt?.id,
  ]);

  const handleRemoveAlias = useCallback(
    (aliasToRemove: string) => {
      const newAliases = currentAliases.filter((a) => a !== aliasToRemove);
      setDraftAlias(newAliases.join(","));
    },
    [currentAliases],
  );

  const handleSave = useCallback(async () => {
    if (!draftName.trim() || !draftContent.trim()) return;

    const conflictError = validateAliases(
      draftAlias,
      isCreating ? "NEW" : viewingPrompt?.id || "",
    );
    if (conflictError) {
      setAliasError(conflictError);
      return;
    }

    try {
      if (isCreating) {
        const newPrompt = await invoke<LLMPrompt>("add_post_process_prompt", {
          name: draftName.trim(),
          prompt: draftContent.trim(),
          modelId: draftModelId === "default" ? null : draftModelId,
          alias: draftAlias.trim() || null,
          icon: draftIcon,
        });
        await refreshSettings();
        setCurrentTab(newPrompt.id);
        if (prompts.length === 0) {
          updateSetting("post_process_selected_prompt_id", newPrompt.id);
        }
        toast.success(t("settings.postProcessing.prompts.createSuccess"));
      } else if (viewingPrompt) {
        await invoke("update_post_process_prompt", {
          id: viewingPrompt.id,
          name: draftName.trim(),
          prompt: draftContent.trim(),
          modelId: draftModelId === "default" ? null : draftModelId,
          alias: draftAlias.trim() || null,
          icon: draftIcon,
        });
        await refreshSettings();
        toast.success(t("settings.postProcessing.prompts.updateSuccess"));
      }
    } catch (error) {
      console.error("Failed to save prompt:", error);
      toast.error(t("settings.postProcessing.prompts.updateFailed"));
    }
  }, [
    draftName,
    draftContent,
    draftAlias,
    draftModelId,
    draftIcon,
    isCreating,
    validateAliases,
    viewingPrompt,
    prompts.length,
    refreshSettings,
    updateSetting,
    t,
  ]);

  const handleDelete = useCallback(async () => {
    if (!viewingPrompt) return;
    try {
      await invoke("delete_post_process_prompt", { id: viewingPrompt.id });
      await refreshSettings();
      setCurrentTab(prompts.length > 1 ? prompts[0].id : "NEW");
      toast.success(t("settings.postProcessing.prompts.deleteSuccess"));
    } catch (error) {
      console.error("Failed to delete prompt:", error);
      toast.error(t("settings.postProcessing.prompts.deleteFailed"));
    }
  }, [viewingPrompt, prompts, refreshSettings, t]);

  const handleSetAsActive = useCallback(() => {
    if (viewingPrompt) {
      updateSetting("post_process_selected_prompt_id", viewingPrompt.id);
      toast.success(t("settings.postProcessing.prompts.activeSet"));
    }
  }, [viewingPrompt, updateSetting, t]);

  const handleSavePrefixes = useCallback(
    async (newPrefixesStr: string) => {
      setPrefixes(newPrefixesStr);
      await invoke("set_command_prefixes", {
        prefixes: newPrefixesStr.trim() || null,
      });
      await refreshSettings();
    },
    [refreshSettings],
  );

  const handleAddPrefix = useCallback(() => {
    const val = currentPrefixInput.trim();
    if (!val) return;

    if (currentPrefixes.some((p) => p.toLowerCase() === val.toLowerCase())) {
      setCurrentPrefixInput("");
      return;
    }

    const newPrefixList = [...currentPrefixes, val];
    handleSavePrefixes(newPrefixList.join(","));
    setCurrentPrefixInput("");
  }, [currentPrefixInput, currentPrefixes, handleSavePrefixes]);

  const handleRemovePrefix = useCallback(
    (prefixToRemove: string) => {
      const newPrefixList = currentPrefixes.filter((p) => p !== prefixToRemove);
      handleSavePrefixes(newPrefixList.join(","));
    },
    [currentPrefixes, handleSavePrefixes],
  );

  return {
    enabled,
    prompts,
    activePromptId,
    currentTab,
    setCurrentTab,
    isCreating,
    viewingPrompt,
    draftName,
    setDraftName,
    draftContent,
    setDraftContent,
    draftAlias,
    setDraftAlias,
    draftModelId,
    setDraftModelId,
    draftIcon,
    setDraftIcon,
    currentAliases,
    currentAliasInput,
    setCurrentAliasInput,
    aliasError,
    setAliasError,
    prefixes,
    currentPrefixes,
    currentPrefixInput,
    setCurrentPrefixInput,
    isDirty,
    textModels,
    handleAddAlias,
    handleRemoveAlias,
    handleSave,
    handleDelete,
    handleSetAsActive,
    handleAddPrefix,
    handleRemovePrefix,
  };
};
