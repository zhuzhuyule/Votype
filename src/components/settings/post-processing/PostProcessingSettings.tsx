import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Textarea } from "../../ui/Textarea";

import { IconButton, TextField } from "@radix-ui/themes";
import { Eye, EyeOff } from "lucide-react";
import { useSettings } from "../../../hooks/useSettings";
import type { LLMPrompt } from "../../../lib/types";
import { ActionWrapper } from "../../ui";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ModelConfigurationPanel } from "./ModelConfigurationPanel";
import { ProviderManager } from "./ProviderManager";

const DisabledNotice: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="p-4 bg-mid-gray/5 rounded-lg border border-mid-gray/20 text-center">
    <p className="text-sm text-mid-gray">{children}</p>
  </div>
);

const PostProcessingSettingsApiComponent: React.FC = () => {
  const state = usePostProcessProviderState();
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <>
      <SettingContainer
        title="Provider"
        description="Select an OpenAI-compatible provider."
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-100">
          <ProviderSelect
            options={state.providerOptions}
            value={state.selectedProviderId}
            onChange={state.handleProviderSelect}
          />
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title="Base URL"
        description="API base URL for the selected provider. Only the custom provider can be edited."
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-100">
          <TextField.Root
            value={state.baseUrl}
            onBlur={(e) => state.handleBaseUrlChange(e.target.value)}
            placeholder="https://api.openai.com/v1"
            disabled={
              !state.selectedProvider?.allow_base_url_edit ||
              state.isBaseUrlUpdating
            }
          />
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title="API Key"
        description="API key for the selected provider."
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-140">
          <TextField.Root
            value={state.apiKey}
            onBlur={(e) => state.handleApiKeyChange(e.target.value)}
            placeholder="sk-..."
            type={showApiKey ? "text" : "password"}
            disabled={state.isApiKeyUpdating}
          >
            <TextField.Slot side="right">
              <IconButton
                size="1"
                variant="ghost"
                onClick={() => setShowApiKey(!showApiKey)}
                type="button"
              >
                {showApiKey ? (
                  <EyeOff height={14} width={14} />
                ) : (
                  <Eye height={14} width={14} />
                )}
              </IconButton>
            </TextField.Slot>
          </TextField.Root>
        </ActionWrapper>
      </SettingContainer>
    </>
  );
};

const PostProcessingSettingsPromptsComponent: React.FC = () => {
  const { getSetting, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");

  const enabled = getSetting("post_process_enabled") || false;
  const prompts = getSetting("post_process_prompts") || [];
  const selectedPromptId = getSetting("post_process_selected_prompt_id") || "";
  const selectedPrompt =
    prompts.find((prompt) => prompt.id === selectedPromptId) || null;

  useEffect(() => {
    if (isCreating) return;

    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  }, [
    isCreating,
    selectedPromptId,
    selectedPrompt?.name,
    selectedPrompt?.prompt,
  ]);

  const handlePromptSelect = (promptId: string | null) => {
    if (!promptId) return;
    updateSetting("post_process_selected_prompt_id", promptId);
    setIsCreating(false);
  };

  const handleCreatePrompt = async () => {
    if (!draftName.trim() || !draftText.trim()) return;

    try {
      const newPrompt = await invoke<LLMPrompt>("add_post_process_prompt", {
        name: draftName.trim(),
        prompt: draftText.trim(),
      });
      await refreshSettings();
      updateSetting("post_process_selected_prompt_id", newPrompt.id);
      setIsCreating(false);
    } catch (error) {
      console.error("Failed to create prompt:", error);
    }
  };

  const handleUpdatePrompt = async () => {
    if (!selectedPromptId || !draftName.trim() || !draftText.trim()) return;

    try {
      await invoke("update_post_process_prompt", {
        id: selectedPromptId,
        name: draftName.trim(),
        prompt: draftText.trim(),
      });
      await refreshSettings();
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    if (!promptId) return;

    try {
      await invoke("delete_post_process_prompt", { id: promptId });
      await refreshSettings();
      setIsCreating(false);
    } catch (error) {
      console.error("Failed to delete prompt:", error);
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setDraftName("");
    setDraftText("");
  };

  if (!enabled) {
    return (
      <DisabledNotice>
        Post processing is currently disabled. Enable it in Debug settings to
        configure.
      </DisabledNotice>
    );
  }

  const hasPrompts = prompts.length > 0;
  const isDirty =
    !!selectedPrompt &&
    (draftName.trim() !== selectedPrompt.name ||
      draftText.trim() !== selectedPrompt.prompt.trim());

  return (
    <SettingContainer
      title="Selected Prompt"
      description="Select a template for refining transcriptions or create a new one. Use ${output} inside the prompt text to reference the captured transcript."
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Dropdown
            selectedValue={selectedPromptId || undefined}
            options={prompts.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            onSelect={(value) => handlePromptSelect(value)}
            placeholder={
              prompts.length === 0 ? "No prompts available" : "Select a prompt"
            }
            disabled={
              isUpdating("post_process_selected_prompt_id") || isCreating
            }
            className="flex-1"
          />
          <Button
            onClick={handleStartCreate}
            variant="primary"
            size="md"
            disabled={isCreating}
          >
            Create New Prompt
          </Button>
        </div>

        {!isCreating && hasPrompts && selectedPrompt && (
          <div className="space-y-3">
            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">Prompt Label</label>
              <TextField.Root
                value={draftName}
                onBlur={(e) => setDraftName(e.target.value)}
                placeholder="Enter prompt name"
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                Prompt Instructions
              </label>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="Write the instructions to run after transcription. Example: Improve grammar and clarity for the following text: ${output}"
              />
              <p className="text-xs text-mid-gray/70">
                Tip: Use{" "}
                <code className="px-1 py-0.5 bg-mid-gray/20 rounded text-xs">
                  $&#123;output&#125;
                </code>{" "}
                to insert the transcribed text in your prompt.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleUpdatePrompt}
                variant="primary"
                size="md"
                disabled={!draftName.trim() || !draftText.trim() || !isDirty}
              >
                Update Prompt
              </Button>
              <Button
                onClick={() => handleDeletePrompt(selectedPromptId)}
                variant="secondary"
                size="md"
                disabled={!selectedPromptId || prompts.length <= 1}
              >
                Delete Prompt
              </Button>
            </div>
          </div>
        )}

        {!isCreating && !selectedPrompt && (
          <div className="p-3 bg-mid-gray/5 rounded border border-mid-gray/20">
            <p className="text-sm text-mid-gray">
              {hasPrompts
                ? "Select a prompt above to view and edit its details."
                : "Click 'Create New Prompt' above to create your first post-processing prompt."}
            </p>
          </div>
        )}

        {isCreating && (
          <div className="space-y-3">
            <div className="space-y-2 block flex flex-col">
              <label className="text-sm font-semibold text-text">
                Prompt Label
              </label>
              <TextField.Root
                value={draftName}
                onBlur={(e) => setDraftName(e.target.value)}
                placeholder="Enter prompt name"
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                Prompt Instructions
              </label>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="Write the instructions to run after transcription. Example: Improve grammar and clarity for the following text: ${output}"
              />
              <p className="text-xs text-mid-gray/70">
                Tip: Use{" "}
                <code className="px-1 py-0.5 bg-mid-gray/20 rounded text-xs">
                  $&#123;output&#125;
                </code>{" "}
                to insert the transcribed text in your prompt.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleCreatePrompt}
                variant="primary"
                size="md"
                disabled={!draftName.trim() || !draftText.trim()}
              >
                Create Prompt
              </Button>
              <Button
                onClick={handleCancelCreate}
                variant="secondary"
                size="md"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingContainer>
  );
};

export const PostProcessingSettingsApi = React.memo(
  PostProcessingSettingsApiComponent,
);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";

export const PostProcessingSettingsPrompts = React.memo(
  PostProcessingSettingsPromptsComponent,
);
PostProcessingSettingsPrompts.displayName = "PostProcessingSettingsPrompts";

export const AiSettings: React.FC = () => {
  const [isProviderManagerOpen, setProviderManagerOpen] = useState(false);
  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup
        title="API (OpenAI Compatible)"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setProviderManagerOpen(true)}
          >
            管理 Providers
          </Button>
        }
      >
        {isProviderManagerOpen && (
          <ProviderManager onClose={() => setProviderManagerOpen(false)} />
        )}
        <PostProcessingSettingsApi />
      </SettingsGroup>
      <SettingsGroup title="AI Model Config">
        <ModelConfigurationPanel />
      </SettingsGroup>
    </div>
  );
};
