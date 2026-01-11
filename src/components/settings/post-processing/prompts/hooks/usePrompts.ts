// Custom hook for prompt management state and actions

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "../../../../../hooks/useSettings";
import type { LLMPrompt, PromptOutputMode } from "../../../../../lib/types";

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
  draftDescription: string;
  setDraftDescription: (value: string) => void;
  draftAlias: string;
  setDraftAlias: (value: string) => void;
  draftModelId: string | null;
  setDraftModelId: (value: string | null) => void;
  draftIcon: string | null;
  setDraftIcon: (value: string | null) => void;
  draftComplianceCheck: boolean;
  setDraftComplianceCheck: (value: boolean) => void;
  draftComplianceThreshold: number;
  setDraftComplianceThreshold: (value: number) => void;
  draftOutputMode: PromptOutputMode;
  setDraftOutputMode: (value: PromptOutputMode) => void;
  draftEnabled: boolean;
  setDraftEnabled: (value: boolean) => void;
  currentAliases: string[];
  currentAliasInput: string;
  setCurrentAliasInput: (value: string) => void;
  aliasError: string | null;
  setAliasError: (error: string | null) => void;

  // Computed
  isDirty: boolean;
  textModels: { value: string; label: string }[];

  // Actions
  handleAddAlias: () => void;
  handleRemoveAlias: (alias: string) => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleSetAsActive: () => void;
  isSuggestingAliases: boolean;
  handleSuggestAliases: () => Promise<void>;
}

export const usePrompts = (
  externalSkills: LLMPrompt[] = [],
  onExternalSkillSaved?: (skillId: string) => Promise<LLMPrompt | null>,
): UsePromptsReturn => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, refreshSettings, settings } =
    useSettings();

  // Settings
  const enabled = getSetting("post_process_enabled") || false;
  const prompts = getSetting("post_process_prompts") || [];
  const activePromptId = getSetting("post_process_selected_prompt_id");

  const [currentTab, setCurrentTab] = useState<string>("NEW");

  // Sync initial tab when settings load
  const hasInitializedTab = useRef(false);
  useEffect(() => {
    if (!hasInitializedTab.current && prompts.length > 0) {
      setCurrentTab(activePromptId || prompts[0].id);
      hasInitializedTab.current = true;
    }
  }, [prompts, activePromptId]);

  // Draft state
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAlias, setDraftAlias] = useState("");
  const [draftModelId, setDraftModelId] = useState<string | null>(null);
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const [draftComplianceCheck, setDraftComplianceCheck] = useState(false);
  const [draftComplianceThreshold, setDraftComplianceThreshold] = useState(70);

  const [draftOutputMode, setDraftOutputMode] =
    useState<PromptOutputMode>("polish");
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [currentAliasInput, setCurrentAliasInput] = useState("");
  const [isSuggestingAliases, setIsSuggestingAliases] = useState(false);

  // Derived values
  const isCreating = currentTab === "NEW";
  const viewingPrompt = useMemo(() => {
    console.log("[usePrompts] Calculating viewingPrompt:", {
      currentTab,
      externalSkillsCount: externalSkills.length,
      externalSkillIds: externalSkills.map((s) => ({
        id: s.id,
        source: s.source,
      })),
      promptsCount: prompts.length,
      promptIds: prompts.map((p) => ({ id: p.id, source: p.source })),
    });

    // First try to find in external skills (file-based)
    const externalSkill = externalSkills.find((s) => s.id === currentTab);
    if (externalSkill) {
      console.log("[usePrompts] Found in externalSkills:", {
        id: externalSkill.id,
        source: externalSkill.source,
      });
      return externalSkill;
    }
    // Then try settings prompts (builtin)
    const prompt = prompts.find((p) => p.id === currentTab);
    if (prompt) {
      console.log("[usePrompts] Found in prompts:", {
        id: prompt.id,
        source: prompt.source,
      });
      return prompt;
    }
    console.log("[usePrompts] NOT FOUND - viewingPrompt will be null");
    return null;
  }, [prompts, currentTab, externalSkills]);

  const currentAliases = useMemo(() => {
    return draftAlias
      .split(/[,，]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }, [draftAlias]);

  const isDirty = useMemo(() => {
    if (isCreating) return true;
    if (!viewingPrompt) return false;
    return (
      draftName !== viewingPrompt.name ||
      draftContent !==
        (viewingPrompt.instructions || viewingPrompt.prompt || "") ||
      draftDescription !== (viewingPrompt.description || "") ||
      draftAlias !== (viewingPrompt.aliases || viewingPrompt.alias || "") ||
      (draftModelId || null) !== (viewingPrompt.model_id || null) ||
      (draftIcon || null) !== (viewingPrompt.icon || null) ||
      draftComplianceCheck !==
        (viewingPrompt.compliance_check_enabled || false) ||
      draftComplianceThreshold !== (viewingPrompt.compliance_threshold ?? 70) ||
      draftOutputMode !== (viewingPrompt.output_mode || "polish") ||
      draftEnabled !== (viewingPrompt.enabled ?? true)
    );
  }, [
    isCreating,
    viewingPrompt,
    draftName,
    draftContent,
    draftDescription,
    draftAlias,
    draftModelId,
    draftIcon,
    draftComplianceCheck,
    draftComplianceThreshold,
    draftOutputMode,
    draftEnabled,
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
        setDraftDescription("");
        setDraftAlias("");
        setDraftModelId(null);
        setDraftIcon(null);
        setDraftComplianceCheck(false);

        setDraftComplianceThreshold(20);
        setDraftOutputMode("polish");
        setDraftEnabled(true);
        setAliasError(null);
        lastLoadedTabRef.current = "NEW";
      }
      return;
    }

    if (viewingPrompt && viewingPrompt.id !== lastLoadedTabRef.current) {
      setDraftName(viewingPrompt.name || "");
      setDraftContent(viewingPrompt.instructions || viewingPrompt.prompt || "");
      setDraftDescription(viewingPrompt.description || "");
      setDraftAlias(viewingPrompt.aliases || viewingPrompt.alias || "");
      setDraftModelId(viewingPrompt.model_id || null);
      setDraftIcon(viewingPrompt.icon || null);
      setDraftComplianceCheck(viewingPrompt.compliance_check_enabled || false);

      setDraftComplianceThreshold(viewingPrompt.compliance_threshold ?? 20);
      setDraftOutputMode(viewingPrompt.output_mode || "polish");
      setDraftEnabled(viewingPrompt.enabled ?? true);
      setAliasError(null);
      lastLoadedTabRef.current = viewingPrompt.id;
    }

    // Only force default tab if NOT looking at an external skill
    // and we're not finding the current tab in any list
    if (
      !viewingPrompt &&
      currentTab !== "NEW" &&
      prompts.length > 0 &&
      externalSkills.length === 0
    ) {
      setCurrentTab(prompts[0].id);
    } else if (
      !viewingPrompt &&
      currentTab !== "NEW" &&
      prompts.length === 0 &&
      externalSkills.length === 0
    ) {
      setCurrentTab("NEW");
    }
  }, [currentTab, viewingPrompt, t, prompts, externalSkills]);

  // Validation
  const validateAliases = useCallback(
    (inputAliases: string, currentPromptId: string | "NEW"): string | null => {
      if (!inputAliases.trim()) return null;

      const newAliases = inputAliases
        .split(/[,，]/)
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.length > 0);

      // Check against internal prompts
      for (const prompt of prompts) {
        if (prompt.id === currentPromptId) continue;

        const existingAliases = (prompt.aliases || "")
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
          name: (draftName || "").trim(),
          instructions: (draftContent || "").trim(),
          modelId: draftModelId === "default" ? null : draftModelId,
          aliases: (draftAlias || "").trim() || null,
          description: (draftDescription || "").trim(),
          icon: draftIcon,
          complianceCheckEnabled: draftComplianceCheck,
          complianceThreshold: Math.round(draftComplianceThreshold),
          outputMode: draftOutputMode,
          enabled: draftEnabled,
        });
        await refreshSettings();
        setCurrentTab(newPrompt.id);
        if (prompts.length === 0) {
          updateSetting("post_process_selected_prompt_id", newPrompt.id);
        }
        toast.success(t("settings.postProcessing.prompts.createSuccess"));
      } else if (viewingPrompt) {
        // Check if external skill
        console.log("[usePrompts] Saving skill:", {
          id: viewingPrompt.id,
          source: viewingPrompt.source,
          isExternal:
            viewingPrompt.source === "user" ||
            viewingPrompt.source === "imported",
        });

        if (
          viewingPrompt.source === "user" ||
          viewingPrompt.source === "imported"
        ) {
          const updatedSkill: LLMPrompt = {
            ...viewingPrompt,
            name: (draftName || "").trim(),
            instructions: (draftContent || "").trim(),
            model_id: draftModelId === "default" ? null : draftModelId,
            aliases: (draftAlias || "").trim() || null,
            description: (draftDescription || "").trim(),
            icon: draftIcon || undefined,
            compliance_check_enabled: draftComplianceCheck,
            compliance_threshold: Math.round(draftComplianceThreshold),
            output_mode: draftOutputMode,
            enabled: draftEnabled,
            customized: true,
          };

          console.log(
            "[usePrompts] Calling save_external_skill with:",
            updatedSkill,
          );
          await invoke("save_external_skill", { skill: updatedSkill });
          console.log("[usePrompts] save_external_skill succeeded");

          // Trigger refresh of external skills list and get updated skill
          if (onExternalSkillSaved) {
            console.log("[usePrompts] Calling onExternalSkillSaved callback");
            await onExternalSkillSaved(viewingPrompt.id);
          }
          toast.success(t("settings.postProcessing.prompts.updateSuccess"));
        } else {
          // Internal prompt
          await invoke("update_post_process_prompt", {
            id: viewingPrompt.id,
            name: (draftName || "").trim(),
            instructions: (draftContent || "").trim(),
            modelId: draftModelId === "default" ? null : draftModelId,
            aliases: (draftAlias || "").trim() || null,
            description: (draftDescription || "").trim(),
            icon: draftIcon,
            complianceCheckEnabled: draftComplianceCheck,
            complianceThreshold: Math.round(draftComplianceThreshold),
            outputMode: draftOutputMode,
            enabled: draftEnabled,
          });
          await refreshSettings();
          toast.success(t("settings.postProcessing.prompts.updateSuccess"));
        }
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
    draftComplianceCheck,
    draftComplianceThreshold,
    draftOutputMode,
    draftEnabled,
    isCreating,
    validateAliases,
    viewingPrompt,
    prompts.length,
    refreshSettings,
    updateSetting,
    t,
    onExternalSkillSaved,
  ]);

  const handleDelete = useCallback(async () => {
    if (!viewingPrompt) return;
    try {
      console.log("[usePrompts] Deleting skill:", {
        id: viewingPrompt.id,
        source: viewingPrompt.source,
        isExternal:
          viewingPrompt.source === "user" ||
          viewingPrompt.source === "imported",
      });

      // Use different delete command based on source
      if (
        viewingPrompt.source === "user" ||
        viewingPrompt.source === "imported"
      ) {
        // External skill - delete the file
        await invoke("delete_skill", { id: viewingPrompt.id });
        console.log("[usePrompts] delete_skill succeeded");
        // Refresh external skills list
        if (onExternalSkillSaved) {
          await onExternalSkillSaved(viewingPrompt.id);
        }
      } else {
        // Internal prompt - delete from settings
        await invoke("delete_post_process_prompt", { id: viewingPrompt.id });
        await refreshSettings();
      }

      setCurrentTab(prompts.length > 1 ? prompts[0].id : "NEW");
      toast.success(t("settings.postProcessing.prompts.deleteSuccess"));
    } catch (error) {
      console.error("Failed to delete prompt:", error);
      toast.error(t("settings.postProcessing.prompts.deleteFailed"));
    }
  }, [viewingPrompt, prompts, refreshSettings, t, onExternalSkillSaved]);

  const handleSetAsActive = useCallback(() => {
    if (viewingPrompt) {
      updateSetting("post_process_selected_prompt_id", viewingPrompt.id);
      toast.success(t("settings.postProcessing.prompts.activeSet"));
    }
  }, [viewingPrompt, updateSetting, t]);

  const handleSuggestAliases = useCallback(async () => {
    if (!draftDescription.trim()) {
      toast.error(t("settings.postProcessing.prompts.descriptionRequired"));
      return;
    }

    setIsSuggestingAliases(true);
    try {
      const suggested = await invoke<string[]>("suggest_aliases", {
        description: draftDescription.trim(),
      });

      if (suggested && suggested.length > 0) {
        // Merge with existing aliases, keeping uniqueness
        const existingSet = new Set(currentAliases.map((a) => a.toLowerCase()));
        const newAliases = [...currentAliases];

        suggested.forEach((alias) => {
          if (!existingSet.has(alias.toLowerCase())) {
            newAliases.push(alias);
          }
        });

        setDraftAlias(newAliases.join(","));
        toast.success(t("settings.postProcessing.prompts.suggestSuccess"));
      } else {
        toast.info(t("settings.postProcessing.prompts.noSuggestions"));
      }
    } catch (error) {
      console.error("Failed to suggest aliases:", error);
      toast.error(t("settings.postProcessing.prompts.suggestFailed"));
    } finally {
      setIsSuggestingAliases(false);
    }
  }, [draftDescription, currentAliases, setDraftAlias, t]);

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
    draftDescription,
    setDraftDescription,
    draftAlias,
    setDraftAlias,
    draftModelId,
    setDraftModelId,
    draftIcon,
    setDraftIcon,
    draftComplianceCheck,
    setDraftComplianceCheck,
    draftComplianceThreshold,
    setDraftComplianceThreshold,
    draftOutputMode,
    setDraftOutputMode,
    draftEnabled,
    setDraftEnabled,
    currentAliases,
    currentAliasInput,
    setCurrentAliasInput,
    aliasError,
    setAliasError,
    isDirty,
    textModels,
    handleAddAlias,
    handleRemoveAlias,
    handleSave,
    handleDelete,
    handleSetAsActive,
    isSuggestingAliases,
    handleSuggestAliases,
  };
};
