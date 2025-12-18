import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  IconButton,
  Tabs,
  Text,
  TextArea,
  TextField
} from "@radix-ui/themes";
import { IconCheck, IconDeviceFloppy, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSettings } from "../../../hooks/useSettings";
import type { LLMPrompt } from "../../../lib/types";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { PostProcessingToggle } from "../PostProcessingToggle";

const PromptsConfiguration: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, refreshSettings, settings } = useSettings();

  // --- State ---
  const enabled = getSetting("post_process_enabled") || false;
  const prompts = getSetting("post_process_prompts") || [];
  const activePromptId = getSetting("post_process_selected_prompt_id"); // The ONE active prompt used by the system

  // We use a local "currentTab" to track which prompt is being viewed/edited
  // It can be a prompt ID or "NEW"
  const [currentTab, setCurrentTab] = useState<string>(activePromptId || (prompts[0]?.id) || "NEW");

  // Local edit state
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftAlias, setDraftAlias] = useState("");
  const [draftModelId, setDraftModelId] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [currentAliasInput, setCurrentAliasInput] = useState("");

  // Helper to parse aliases from string
  const currentAliases = useMemo(() => {
    return draftAlias
      .split(/[,，]/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
  }, [draftAlias]);


  // Command Prefixes State
  const [prefixes, setPrefixes] = useState("");
  const [currentPrefixInput, setCurrentPrefixInput] = useState("");
  const lastLoadedPrefixesRef = useRef<string | null>(null);

  // Derived: List of prefixes
  const currentPrefixes = useMemo(() => {
    return prefixes
      .split(/[,，]/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
  }, [prefixes]);

  // Derived: Is the current tab a "Create New" tab?
  const isCreating = currentTab === "NEW";
  // Derived: The prompt object for the current tab (if not creating)
  const viewingPrompt = useMemo(() =>
    prompts.find(p => p.id === currentTab) || null
    , [prompts, currentTab]);

  // --- Synchronization Effect ---
  // When switching tabs, load the data into the draft
  const lastLoadedTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentTab === "NEW") {
      if (lastLoadedTabRef.current !== "NEW") {
        setDraftName(t("settings.postProcessing.prompts.newPromptName"));
        setDraftContent("");
        setDraftAlias("");
        setDraftModelId(null);
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
      setAliasError(null);
      lastLoadedTabRef.current = viewingPrompt.id;
    }
    // If viewingPrompt is null but tab isn't NEW (e.g. deleted), handle gracefully? 
    // For now, if prompt disappears, we might want to switch to NEW or first available.
    if (!viewingPrompt && currentTab !== "NEW" && prompts.length > 0) {
      setCurrentTab(prompts[0].id);
    } else if (!viewingPrompt && currentTab !== "NEW" && prompts.length === 0) {
      setCurrentTab("NEW");
    }
  }, [currentTab, viewingPrompt, t, prompts]);

  // Sync Prefixes from Settings
  useEffect(() => {
    const backendPrefixes = settings?.command_prefixes || "";
    if (backendPrefixes !== lastLoadedPrefixesRef.current) {
      setPrefixes(backendPrefixes);
      lastLoadedPrefixesRef.current = backendPrefixes;
    }
  }, [settings?.command_prefixes]);

  // --- Computed Data ---
  const cachedModels = settings?.cached_models || [];
  const textModels = useMemo(() => {
    // Determine the label for the "Default" option based on global selection
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
          (p) => p.id === model.provider_id
        );
        const providerLabel = provider ? provider.label : model.provider_id;
        return {
          value: model.id,
          label: `${model.custom_label || model.name} (${providerLabel})`,
        };
      });
    return [{ value: "default", label: defaultLabel }, ...options];
  }, [cachedModels, settings?.post_process_providers, settings?.selected_prompt_model_id, t]);

  // --- Handlers ---
  const validateAliases = (inputAliases: string, currentPromptId: string | "NEW"): string | null => {
    if (!inputAliases.trim()) return null;

    const newAliases = inputAliases.split(/[,，]/)
      .map(a => a.trim().toLowerCase())
      .filter(a => a.length > 0);

    for (const prompt of prompts) {
      if (prompt.id === currentPromptId) continue;

      const existingAliases = (prompt.alias || "").split(/[,，]/)
        .map(a => a.trim().toLowerCase())
        .filter(a => a.length > 0);

      // Also check prompt Name as an implicit alias/trigger
      const existingName = prompt.name.trim().toLowerCase();
      if (existingName) {
        existingAliases.push(existingName);
      }

      for (const newAlias of newAliases) {
        if (existingAliases.includes(newAlias)) {
          return t("settings.postProcessing.prompts.aliasDuplicate", { alias: newAlias, promptName: prompt.name });
        }
      }
    }
    return null;
  };

  const handleAddAlias = () => {
    const val = currentAliasInput.trim();
    if (!val) return;

    // Check for duplicates in current list
    if (currentAliases.some(a => a.toLowerCase() === val.toLowerCase())) {
      setCurrentAliasInput(""); // Clear duplicate input
      return;
    }

    // Prepare new full alias string to validate against OTHER prompts
    const newAliasList = [...currentAliases, val];
    const newAliasString = newAliasList.join(",");

    const error = validateAliases(val, isCreating ? "NEW" : (viewingPrompt?.id || ""));
    if (error) {
      setAliasError(error);
      return;
    }

    setDraftAlias(newAliasString);
    setCurrentAliasInput("");
    setAliasError(null);
  };

  const handleRemoveAlias = (aliasToRemove: string) => {
    const newAliases = currentAliases.filter(a => a !== aliasToRemove);
    setDraftAlias(newAliases.join(","));
  };

  const handleAliasKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddAlias();
    }
  };


  const handleSave = async () => {
    if (!draftName.trim() || !draftContent.trim()) return;

    // Validate Aliases
    const conflictError = validateAliases(draftAlias, isCreating ? "NEW" : (viewingPrompt?.id || ""));
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
        });
        await refreshSettings();
        // Switch to the new prompt
        setCurrentTab(newPrompt.id);
        // Also set as active if it's the first one? optional.
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
        });
        await refreshSettings();
        toast.success(t("settings.postProcessing.prompts.updateSuccess"));
      }
    } catch (error) {
      console.error("Failed to save prompt:", error);
      toast.error(t("settings.postProcessing.prompts.updateFailed"));
    }
  };

  const handleDelete = async () => {
    if (!viewingPrompt) return;
    try {
      await invoke("delete_post_process_prompt", { id: viewingPrompt.id });
      await refreshSettings();
      // Switch logic handled by useEffect, or force here:
      setCurrentTab(prompts.length > 1 ? prompts[0].id : "NEW");
      toast.success(t("settings.postProcessing.prompts.deleteSuccess"));
    } catch (error) {
      console.error("Failed to delete prompt:", error);
      toast.error(t("settings.postProcessing.prompts.deleteFailed"));
    }
  };

  const handleSetAsActive = () => {
    if (viewingPrompt) {
      updateSetting("post_process_selected_prompt_id", viewingPrompt.id);
      toast.success(t("settings.postProcessing.prompts.activeSet"));
    }
  };

  const handleSavePrefixes = async (newPrefixesStr: string) => {
    setPrefixes(newPrefixesStr);
    await invoke("set_command_prefixes", { prefixes: newPrefixesStr.trim() || null });
    await refreshSettings();
    // Toast is optional for frequent updates, but good for feedback
    // toast.success(t("settings.postProcessing.prompts.prefixesSaved"));
  };

  const handleAddPrefix = () => {
    const val = currentPrefixInput.trim();
    if (!val) return;

    if (currentPrefixes.some(p => p.toLowerCase() === val.toLowerCase())) {
      setCurrentPrefixInput("");
      return;
    }

    const newPrefixList = [...currentPrefixes, val];
    const newPrefixesStr = newPrefixList.join(",");
    handleSavePrefixes(newPrefixesStr);
    setCurrentPrefixInput("");
  };

  const handleRemovePrefix = (prefixToRemove: string) => {
    const newPrefixList = currentPrefixes.filter(p => p !== prefixToRemove);
    const newPrefixesStr = newPrefixList.join(",");
    handleSavePrefixes(newPrefixesStr);
  };

  const handlePrefixKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddPrefix();
    }
  };

  const isDirty = useMemo(() => {
    if (isCreating) return true;
    if (!viewingPrompt) return false;
    return (
      draftName !== viewingPrompt.name ||
      draftContent !== viewingPrompt.prompt ||
      draftAlias !== (viewingPrompt.alias || "") ||
      (draftModelId || null) !== (viewingPrompt.model_id || null)
    );
  }, [isCreating, viewingPrompt, draftName, draftContent, draftAlias, draftModelId]);

  // Calculate tabs to show
  // We append a special "ADD_BUTTON" value to the list just for rendering the trigger
  const tabItems = [...prompts];

  return (
    <Flex direction="column" gap="5" className="max-w-5xl w-full mx-auto">
      <SettingsGroup title={t("settings.postProcessing.prompts.title")}>
        <PostProcessingToggle grouped={true} />

        {enabled && (
          <Box pb="2">
            {/* Command Prefixes Configuration */}
            <SettingContainer
              title={t("settings.postProcessing.prompts.commandPrefixTitle")}
              description={t("settings.postProcessing.prompts.commandPrefixDescription")}
              descriptionMode="inline"
              grouped
              layout="stacked"
            >
              <Grid columns="2fr 5fr" gap="4" align="center" width="100%">
                {/* Left: Input */}
                <Flex gap="2">
                  <TextField.Root
                    variant="surface"
                    value={currentPrefixInput}
                    onChange={e => setCurrentPrefixInput(e.target.value)}
                    onKeyDown={handlePrefixKeyDown}
                    placeholder={t("settings.postProcessing.prompts.commandPrefixPlaceholder")}
                    className="flex-1"
                  />
                  <IconButton variant="soft" color="gray" onClick={handleAddPrefix} disabled={!currentPrefixInput.trim()}>
                    <IconPlus size={16} />
                  </IconButton>
                </Flex>

                {/* Right: Tags */}
                <Flex wrap="wrap" gap="2" align="center">
                  {currentPrefixes.map((prefix, i) => (
                    <Badge key={i} size="2" variant="soft" color="orange" className="px-2 py-1 gap-1 cursor-default">
                      {prefix}
                      <IconX
                        size={13}
                        className="cursor-pointer hover:text-red-600 opacity-60 hover:opacity-100 transition-opacity"
                        onClick={() => handleRemovePrefix(prefix)}
                      />
                    </Badge>
                  ))}
                  {currentPrefixes.length === 0 && (
                    <Text size="1" color="gray" className="italic opacity-70">
                      {t("settings.postProcessing.prompts.noPrefixes") || "No prefixes added"}
                    </Text>
                  )}
                </Flex>
              </Grid>
            </SettingContainer>

            <Tabs.Root value={currentTab} onValueChange={setCurrentTab} className="pt-4">
              <Tabs.List>
                {tabItems.map(prompt => (
                  <Tabs.Trigger key={prompt.id} value={prompt.id} className="relative pr-6">
                    <Flex align="center" gap="2">
                      {prompt.name}
                      {/* Green Check for Active Prompt */}
                      {activePromptId === prompt.id && (
                        <Box className="text-green-500 flex items-center justify-center">
                          <IconCheck size={14} stroke={3} />
                        </Box>
                      )}
                    </Flex>
                  </Tabs.Trigger>
                ))}
                {/* New Prompt Trigger - styled as a simple icon button within the tab list flow */}
                <Tabs.Trigger value="NEW" style={{ padding: "0 12px" }}>
                  <IconPlus size={16} />
                </Tabs.Trigger>
              </Tabs.List>

              <Box pt="4">
                <Flex direction="column" gap="4">
                  {/* Toolbar / Header */}
                  <Flex justify="between" align="center">
                    <Heading size="3">
                      {isCreating ? t("settings.postProcessing.prompts.createPrompt") : t("settings.postProcessing.prompts.editPrompt")}
                    </Heading>
                    <Flex gap="3">
                      {!isCreating && viewingPrompt && activePromptId !== viewingPrompt.id && (
                        <Button variant="outline" onClick={handleSetAsActive}>
                          {t("settings.postProcessing.prompts.setAsActive")}
                        </Button>
                      )}
                      {!isCreating && (
                        <AlertDialog.Root>
                          <AlertDialog.Trigger>
                            <Button variant="soft" color="red" disabled={prompts.length <= 1 && !isCreating}>
                              <IconTrash size={16} />
                            </Button>
                          </AlertDialog.Trigger>
                          <AlertDialog.Content maxWidth="450px">
                            <AlertDialog.Title>{t("settings.postProcessing.prompts.deleteConfirm.title")}</AlertDialog.Title>
                            <AlertDialog.Description size="2">
                              {t("settings.postProcessing.prompts.deleteConfirm.description")}
                            </AlertDialog.Description>
                            <Flex gap="3" mt="4" justify="end">
                              <AlertDialog.Cancel>
                                <Button variant="soft" color="gray">
                                  {t("common.cancel")}
                                </Button>
                              </AlertDialog.Cancel>
                              <AlertDialog.Action>
                                <Button variant="solid" color="red" onClick={handleDelete}>
                                  {t("common.delete")}
                                </Button>
                              </AlertDialog.Action>
                            </Flex>
                          </AlertDialog.Content>
                        </AlertDialog.Root>
                      )}
                      <Button
                        variant="solid"
                        onClick={handleSave}
                        disabled={!isDirty || !draftName.trim() || !draftContent.trim()}
                      >
                        <IconDeviceFloppy size={18} />
                        {t("common.save")}
                      </Button>
                    </Flex>
                  </Flex>

                  {/* Form - Top Row: Prompt Name & Model */}
                  <Grid columns="2" gap="4">
                    <Box>
                      <Text size="2" weight="medium" mb="1" as="div">{t("settings.postProcessing.prompts.promptLabel")}</Text>
                      <TextField.Root
                        variant="surface"
                        value={draftName}
                        onChange={e => setDraftName(e.target.value)}
                        placeholder={t("settings.postProcessing.prompts.promptLabelPlaceholder")}
                      />
                    </Box>

                    <Flex direction="column" className="min-w-0">
                      <Text size="2" weight="medium" mb="1" as="div">{t("settings.postProcessing.api.model.title")}</Text>
                      <Dropdown
                        options={textModels}
                        selectedValue={draftModelId || "default"}
                        onSelect={(val) => setDraftModelId(val === "default" ? null : val)}
                        placeholder={t("common.default")}
                        className="w-full flex-1"
                      />
                    </Flex>
                  </Grid>

                  {/* Form - Second Row: Aliases (Input Left, Tags Right) */}
                  <Box>
                    <Text size="2" weight="medium" mb="2" as="div">{t("settings.postProcessing.prompts.aliasLabel") || "Alias / Trigger"}</Text>

                    <Grid columns="2fr 5fr" gap="4" align="center">
                      {/* Left: Input Field */}
                      <Flex gap="2">
                        <TextField.Root
                          variant="surface"
                          placeholder={t("settings.postProcessing.prompts.aliasPlaceholder") || "Type alias and Enter..."}
                          value={currentAliasInput}
                          onChange={e => {
                            setCurrentAliasInput(e.target.value);
                            if (aliasError) setAliasError(null);
                          }}
                          onKeyDown={handleAliasKeyDown}
                          className="flex-1"
                        />
                        <IconButton variant="soft" color="gray" onClick={handleAddAlias} disabled={!currentAliasInput.trim()}>
                          <IconPlus size={16} />
                        </IconButton>
                      </Flex>

                      {/* Right: Tags Display */}
                      <Flex wrap="wrap" gap="2" align="center">
                        {currentAliases.map((alias, i) => (
                          <Badge key={i} size="2" variant="soft" color="indigo" className="px-2 py-1 gap-1 cursor-default">
                            {alias}
                            <IconX
                              size={13}
                              className="cursor-pointer hover:text-red-600 opacity-60 hover:opacity-100 transition-opacity"
                              onClick={() => handleRemoveAlias(alias)}
                            />
                          </Badge>
                        ))}
                        {currentAliases.length === 0 && (
                          <Text size="1" color="gray" className="italic opacity-70">
                            {t("settings.postProcessing.prompts.noAliases") || "No aliases added"}
                          </Text>
                        )}
                      </Flex>
                    </Grid>

                    {aliasError && (
                      <Text size="1" color="red" mt="1">{aliasError}</Text>
                    )}
                  </Box>

                  {/* Form - Main Editor */}
                  <ResizableEditor
                    label={t("settings.postProcessing.prompts.promptInstructions")}
                    value={draftContent}
                    onChange={setDraftContent}
                    placeholder={t("settings.postProcessing.prompts.promptInstructionsPlaceholder")}
                    tipKey="settings.postProcessing.prompts.promptTip"
                  />
                </Flex>
              </Box>
            </Tabs.Root>
          </Box>
        )}
      </SettingsGroup>
    </Flex>
  );
};

// Sub-component for resizable editor to keep main component clean
const ResizableEditor: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  tipKey: string;
}> = ({ label, value, onChange, placeholder, tipKey }) => {
  const [height, setHeight] = useState(400);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientY - startY.current;
      const newHeight = Math.max(150, startHeight.current + delta); // Min height 150px
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none"; // Prevent text selection while dragging
  };

  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">{label}</Text>

      <Box className="relative group">
        <TextArea
          variant="surface"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-sm leading-relaxed border-gray-200 p-4 transition-none"
          style={{ height: height, resize: "none" }} // Disable native resize
        />

        {/* Custom Resize Handle */}
        <Box
          className="absolute bottom-0 left-1/2 w-full max-w-[200px] cursor-ns-resize flex items-center justify-center hover:bg-black/5 transition-colors rounded-b"
          onMouseDown={handleMouseDown}
          style={{
            touchAction: "none",
            transform: "translate(-50%, 50%)", // combine centering X and offset Y
            bottom: "1px",
            opacity: 0.6
          }}
        >
          {/* Grip Lines Icon or Graphic */}
          <Box className="w-full h-1.5 bg-gray-300 rounded-full group-hover:bg-gray-500 transition-colors shadow-sm" />
        </Box>
      </Box>

      <Text size="1" color="gray">
        <Trans
          i18nKey={tipKey}
          components={{
            code: (
              <code className="px-1.5 py-0.5 bg-gray-100/80 rounded text-xs font-mono text-gray-700 mx-1" />
            ),
            br: <br />,
          }}
        />
      </Text>
    </Flex>
  );
};

export { PromptsConfiguration };
