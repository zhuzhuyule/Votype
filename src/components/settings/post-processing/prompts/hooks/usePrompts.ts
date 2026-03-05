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
  draftModelId: string | null;
  setDraftModelId: (value: string | null) => void;
  draftIcon: string | null;
  setDraftIcon: (value: string | null) => void;
  draftConfidenceCheck: boolean;
  setDraftConfidenceCheck: (value: boolean) => void;
  draftConfidenceThreshold: number;
  setDraftConfidenceThreshold: (value: number) => void;
  draftOutputMode: PromptOutputMode;
  setDraftOutputMode: (value: PromptOutputMode) => void;
  draftLocked: boolean;
  setDraftLocked: (value: boolean) => void;

  // Computed
  isDirty: boolean;
  textModels: { value: string; label: string }[];

  // Actions
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleSetAsActive: () => void;
  isSaving: boolean;
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
  const [isSaving, setIsSaving] = useState(false);

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
  const [draftModelId, setDraftModelId] = useState<string | null>(null);
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const [draftConfidenceCheck, setDraftConfidenceCheck] = useState(false);
  const [draftConfidenceThreshold, setDraftConfidenceThreshold] = useState(70);

  const [draftOutputMode, setDraftOutputMode] =
    useState<PromptOutputMode>("polish");
  const [draftLocked, setDraftLocked] = useState(false);

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

  const isDirty = useMemo(() => {
    if (isCreating) return false; // NEW state shouldn't be "saveable" via this button
    if (!viewingPrompt) return false;
    return (
      draftName !== viewingPrompt.name ||
      draftContent !==
        (viewingPrompt.instructions || viewingPrompt.prompt || "") ||
      draftDescription !== (viewingPrompt.description || "") ||
      (draftModelId || null) !== (viewingPrompt.model_id || null) ||
      (draftIcon || null) !== (viewingPrompt.icon || null) ||
      draftConfidenceCheck !==
        (viewingPrompt.confidence_check_enabled || false) ||
      draftConfidenceThreshold !== (viewingPrompt.confidence_threshold ?? 70) ||
      draftOutputMode !== (viewingPrompt.output_mode || "polish") ||
      draftLocked !== (viewingPrompt.locked ?? false)
    );
  }, [
    isCreating,
    viewingPrompt,
    draftName,
    draftContent,
    draftDescription,
    draftModelId,
    draftIcon,
    draftConfidenceCheck,
    draftConfidenceThreshold,
    draftOutputMode,
    draftLocked,
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
        setDraftModelId(null);
        setDraftIcon(null);
        setDraftConfidenceCheck(false);
        setDraftConfidenceThreshold(70);
        setDraftOutputMode("polish");
        setDraftLocked(false);
        lastLoadedTabRef.current = "NEW";
      }
      return;
    }

    if (viewingPrompt && viewingPrompt.id !== lastLoadedTabRef.current) {
      setDraftName(viewingPrompt.name || "");
      setDraftContent(viewingPrompt.instructions || viewingPrompt.prompt || "");
      setDraftDescription(viewingPrompt.description || "");
      setDraftModelId(viewingPrompt.model_id || null);
      setDraftIcon(viewingPrompt.icon || null);
      setDraftConfidenceCheck(viewingPrompt.confidence_check_enabled || false);
      setDraftConfidenceThreshold(viewingPrompt.confidence_threshold ?? 70);
      setDraftOutputMode(viewingPrompt.output_mode || "polish");
      setDraftLocked(viewingPrompt.locked ?? false);
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

  // Actions
  const handleSave = useCallback(async () => {
    if (!viewingPrompt) {
      console.log("[usePrompts] No viewingPrompt, nothing to save");
      return;
    }

    if (!draftName.trim() || !draftContent.trim()) {
      toast.error("名称和内容不能为空");
      return;
    }

    setIsSaving(true);
    try {
      // All skills use the same save command
      const updatedSkill: LLMPrompt = {
        ...viewingPrompt,
        name: draftName.trim(),
        instructions: draftContent.trim(),
        model_id: draftModelId === "default" ? null : draftModelId,
        description: draftDescription.trim(),
        icon: draftIcon || undefined,
        confidence_check_enabled: draftConfidenceCheck,
        confidence_threshold: Math.round(draftConfidenceThreshold),
        output_mode: draftOutputMode,
        locked: draftLocked,
        enabled: true,
        customized: true,
      };

      console.log("[usePrompts] Saving skill:", updatedSkill.id);
      await invoke("save_external_skill", { skill: updatedSkill });
      console.log("[usePrompts] save_external_skill succeeded");

      // Trigger refresh
      if (viewingPrompt.source === "builtin") {
        // Built-in skills are stored in settings, refresh settings to pick up changes
        await refreshSettings();
      }
      if (onExternalSkillSaved) {
        await onExternalSkillSaved(viewingPrompt.id);
      }
      // Force draft re-sync on next render so isDirty resets
      lastLoadedTabRef.current = null;
      toast.success(t("settings.postProcessing.prompts.updateSuccess"));
    } catch (error) {
      console.error("Failed to save skill:", error);
      toast.error(t("settings.postProcessing.prompts.updateFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [
    draftName,
    draftContent,
    draftModelId,
    draftIcon,
    draftConfidenceCheck,
    draftConfidenceThreshold,
    draftOutputMode,
    draftLocked,
    draftDescription,
    viewingPrompt,
    t,
    refreshSettings,
    onExternalSkillSaved,
  ]);

  const handleDelete = useCallback(async () => {
    if (!viewingPrompt) return;

    try {
      console.log("[usePrompts] Deleting skill:", viewingPrompt.id);

      // All skills use the same delete command
      await invoke("delete_skill", { id: viewingPrompt.id });
      console.log("[usePrompts] delete_skill succeeded");

      // Refresh skills list
      if (onExternalSkillSaved) {
        await onExternalSkillSaved(viewingPrompt.id);
      }

      // Select first skill or nothing
      const remainingSkills = externalSkills.filter(
        (s) => s.id !== viewingPrompt.id,
      );
      setCurrentTab(remainingSkills.length > 0 ? remainingSkills[0].id : "");

      toast.success(t("settings.postProcessing.prompts.deleteSuccess"));
    } catch (error) {
      console.error("Failed to delete skill:", error);
      toast.error(t("settings.postProcessing.prompts.deleteFailed"));
    }
  }, [viewingPrompt, externalSkills, t, onExternalSkillSaved]);

  const handleSetAsActive = useCallback(() => {
    if (viewingPrompt) {
      updateSetting("post_process_selected_prompt_id", viewingPrompt.id);
      toast.success(t("settings.postProcessing.prompts.activeSet"));
    }
  }, [viewingPrompt, updateSetting, t]);

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
    draftModelId,
    setDraftModelId,
    draftIcon,
    setDraftIcon,
    draftConfidenceCheck,
    setDraftConfidenceCheck,
    draftConfidenceThreshold,
    setDraftConfidenceThreshold,
    draftOutputMode,
    setDraftOutputMode,
    draftLocked,
    setDraftLocked,
    isDirty,
    textModels,
    handleSave,
    handleDelete,
    handleSetAsActive,
    isSaving,
  };
};
