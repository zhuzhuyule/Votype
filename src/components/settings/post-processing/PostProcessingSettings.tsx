import { PlusIcon } from "@radix-ui/react-icons";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Separator,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../../hooks/useSettings";
import type { LLMPrompt } from "../../../lib/types";
import { ActionWrapper } from "../../ui";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Textarea } from "../../ui/Textarea";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ModelConfigurationPanel } from "./ModelConfigurationPanel";
import { ProviderManager } from "./ProviderManager";

const DisabledNotice: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Flex align="center" justify="center" py="6" px="4">
    <Text size="2" color="gray">
      {children}
    </Text>
  </Flex>
);

const ApiSettings: React.FC = () => {
  const { t } = useTranslation();
  const state = usePostProcessProviderState();
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <Flex direction="column" gap="4">
      <SettingContainer
        title={t("postProcessing.title")}
        description={t("postProcessing.description")}
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
        title={t("postProcessing.baseUrlTitle")}
        description={t("postProcessing.baseUrlDescription")}
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
        title={t("postProcessing.apiKeyTitle")}
        description={t("postProcessing.apiKeyDescription")}
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
    </Flex>
  );
};

const PromptSettings: React.FC = () => {
  const { t } = useTranslation();
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
      <DisabledNotice>{t("postProcessing.disabledNotice")}</DisabledNotice>
    );
  }

  const hasPrompts = prompts.length > 0;
  const isDirty =
    !!selectedPrompt &&
    (draftName.trim() !== selectedPrompt.name ||
      draftText.trim() !== selectedPrompt.prompt.trim());

  return (
    <>
      <SettingContainer
        title={t("postProcessing.selectedPromptTitle")}
        description={t("postProcessing.selectedPromptDescription")}
      >
        <ActionWrapper>
          <Dropdown
            selectedValue={selectedPromptId || undefined}
            options={prompts.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            onSelect={(value) => handlePromptSelect(value)}
            placeholder={
              prompts.length === 0
                ? t("postProcessing.noPromptsAvailable")
                : t("postProcessing.selectPrompt")
            }
            disabled={
              isUpdating("post_process_selected_prompt_id") || isCreating
            }
            className="flex-1"
          />
          {!isCreating && (
            <Tooltip content={t("postProcessing.createNewPrompt")}>
              <IconButton
                size="1"
                variant="outline"
                onClick={handleStartCreate}
              >
                <PlusIcon />
              </IconButton>
            </Tooltip>
          )}
        </ActionWrapper>
      </SettingContainer>
      <Separator my="3" size="4" />
      <SettingContainer
        title={t("postProcessing.promptLabel")}
        descriptionMode="inline"
        description=""
      >
        <ActionWrapper>
          <TextField.Root
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t("ui.enterPromptName")}
          />
        </ActionWrapper>
      </SettingContainer>
      <SettingContainer
        title={t("postProcessing.promptInstructions")}
        descriptionMode="inline"
        description=""
        layout="stacked"
      >
        <Textarea
          value={draftText}
          rows={20}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder={t("ui.writeInstructions")}
        />
        <Text size="1" color="gray">
          {t("ui.tipUse")}{" "}
          <code className="px-1 py-0.5 bg-mid-gray/20 rounded text-xs">
            $&#123;output&#125;
          </code>{" "}
          {t("ui.toInsertText")}
        </Text>
        <Flex gap="2" pt="2">
          {isCreating ? (
            <>
              <Button
                onClick={handleCreatePrompt}
                variant="solid"
                size="2"
                disabled={!draftName.trim() || !draftText.trim()}
              >
                {t("ui.createPrompt")}
              </Button>
              <Button onClick={handleCancelCreate} variant="outline" size="2">
                {t("ui.cancel")}
              </Button>
            </>
          ) : !!selectedPrompt ? (
            <>
              <Button
                onClick={handleUpdatePrompt}
                variant="solid"
                size="2"
                disabled={!isDirty || !draftName.trim() || !draftText.trim()}
              >
                {t("ui.save")}
              </Button>
              <Button
                onClick={() => handleDeletePrompt(selectedPrompt.id)}
                variant="outline"
                color="red"
                size="2"
                disabled={prompts.length <= 1}
              >
                {t("ui.delete")}
              </Button>
            </>
          ) : null}
        </Flex>
      </SettingContainer>
    </>
  );
};

export const PostProcessingSettingsApi = React.memo(ApiSettings);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";

export const PostProcessingSettingsPrompts = React.memo(PromptSettings);
PostProcessingSettingsPrompts.displayName = "PostProcessingSettingsPrompts";

export const AiSettings: React.FC = () => {
  const { t } = useTranslation();
  const [isProviderManagerOpen, setProviderManagerOpen] = useState(false);

  return (
    <Flex direction="column" gap="6" className="max-w-3xl w-full mx-auto">
      <SettingsGroup
        title={t("postProcessing.apiTitle")}
        actions={
          <Button
            variant="outline"
            size="1"
            onClick={() => setProviderManagerOpen(true)}
          >
            {t("postProcessing.manageProviders")}
          </Button>
        }
      >
        <PostProcessingSettingsApi />
      </SettingsGroup>

      <SettingsGroup title={t("postProcessing.aiModelConfig")}>
        <ModelConfigurationPanel />
      </SettingsGroup>

      {/* Provider Manager Dialog */}
      <Dialog.Root
        open={isProviderManagerOpen}
        onOpenChange={setProviderManagerOpen}
      >
        <Dialog.Content maxWidth="900px" style={{ maxHeight: "80vh" }}>
          <Dialog.Title>{t("postProcessing.manageProviders")}</Dialog.Title>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <ProviderManager onClose={() => setProviderManagerOpen(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};
