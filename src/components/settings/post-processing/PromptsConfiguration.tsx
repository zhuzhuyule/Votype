import { IconPlus } from "@tabler/icons-react";
import {
  Button,
  Flex,
  IconButton,
  Separator,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { useSettings } from "../../../hooks/useSettings";
import type { LLMPrompt } from "../../../lib/types";
import { ActionWrapper } from "../../ui";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Textarea } from "../../ui/Textarea";
import { PostProcessingToggle } from "../PostProcessingToggle";
import { SecondaryTranscriptFusion } from "./SecondaryTranscriptFusion";

const DisabledNotice: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Flex align="center" justify="center" py="6" px="4">
    <Text size="2" color="gray">
      {children}
    </Text>
  </Flex>
);

const PromptSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, refreshSettings, settings } =
    useSettings();

  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftModelId, setDraftModelId] = useState<string | null>(null);

  const enabled = getSetting("post_process_enabled") || false;
  const prompts = getSetting("post_process_prompts") || [];
  const selectedPromptId = getSetting("post_process_selected_prompt_id") || "";
  const cachedModels = getSetting("cached_models") || [];
  const selectedPromptModelId = getSetting("selected_prompt_model_id");

  const textModels = useMemo(() => {
    const options = cachedModels
      .filter((model) => model.model_type === "text")
      .map((model) => {
        const provider = settings?.post_process_providers.find(
          (provider) => provider.id === model.provider_id,
        );
        const providerLabel = provider ? provider.label : model.provider_id;
        return {
          value: model.id,
          label: `${model.custom_label || model.name} (${providerLabel})`,
        };
      });

    const defaultModel = cachedModels.find((model) => model.id === selectedPromptModelId);
    const defaultLabel = defaultModel
      ? `${t("common.default")} (${defaultModel.custom_label || defaultModel.name})`
      : t("common.default");

    return [{ value: "default", label: defaultLabel }, ...options];
  }, [cachedModels, selectedPromptModelId, settings?.post_process_providers, t]);

  const selectedPrompt =
    prompts.find((prompt) => prompt.id === selectedPromptId) || null;

  const lastLoadedPromptId = useRef<string | null>(null);

  useEffect(() => {
    if (isCreating) {
      lastLoadedPromptId.current = null;
      return;
    }

    if (selectedPrompt && selectedPrompt.id !== lastLoadedPromptId.current) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
      setDraftModelId(selectedPrompt.model_id || null);
      lastLoadedPromptId.current = selectedPrompt.id;
    } else if (!selectedPrompt && !isCreating) {
      setDraftName("");
      setDraftText("");
      setDraftModelId(null);
      lastLoadedPromptId.current = null;
    }
  }, [isCreating, selectedPrompt]);

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
        modelId: draftModelId,
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
        modelId: draftModelId,
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
      setDraftModelId(selectedPrompt.model_id || null);
    } else {
      setDraftName("");
      setDraftText("");
      setDraftModelId(null);
    }
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setDraftName("");
    setDraftText("");
    setDraftModelId(null);
  };

  if (!enabled) {
    return (
      <DisabledNotice>{t("settings.postProcessing.disabledNotice")}</DisabledNotice>
    );
  }

  const isDirty =
    !!selectedPrompt &&
    (draftName.trim() !== selectedPrompt.name ||
      draftText.trim() !== selectedPrompt.prompt.trim() ||
      draftModelId !== (selectedPrompt.model_id || null));

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.prompts.selectedPrompt.title")}
        description={t("settings.postProcessing.prompts.selectedPrompt.description")}
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
                ? t("settings.postProcessing.prompts.noPrompts")
                : t("settings.postProcessing.prompts.selectPrompt")
            }
            disabled={isUpdating("post_process_selected_prompt_id") || isCreating}
            className="flex-1"
          />
          {!isCreating && (
            <Tooltip content={t("settings.postProcessing.prompts.createNew")}>
              <IconButton size="1" variant="outline" onClick={handleStartCreate}>
                <IconPlus size={18} />
              </IconButton>
            </Tooltip>
          )}
        </ActionWrapper>
      </SettingContainer>
      <Separator my="3" size="4" />
      <SettingContainer
        title={t("settings.postProcessing.prompts.promptLabel")}
        descriptionMode="inline"
        description=""
      >
        <ActionWrapper>
          <TextField.Root
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t("settings.postProcessing.prompts.promptLabelPlaceholder")}
          />
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title={t("settings.postProcessing.api.model.title")}
        descriptionMode="inline"
        description=""
      >
        <ActionWrapper>
          <Dropdown
            options={textModels}
            selectedValue={draftModelId || "default"}
            onSelect={(value) => setDraftModelId(value === "default" ? null : value)}
            placeholder={t("common.default")}
            className="flex-1"
          />
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title={t("settings.postProcessing.prompts.promptInstructions")}
        descriptionMode="inline"
        description=""
        layout="stacked"
      >
        <Textarea
          value={draftText}
          rows={20}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder={t("settings.postProcessing.prompts.promptInstructionsPlaceholder")}
        />
        <Text size="1" color="gray">
          <Trans
            i18nKey="settings.postProcessing.prompts.promptTip"
            components={{
              code: (
                <code className="px-1 py-0.5 bg-mid-gray/20 rounded text-xs" />
              ),
            }}
          />
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
                {t("settings.postProcessing.prompts.createPrompt")}
              </Button>
              <Button onClick={handleCancelCreate} variant="outline" size="2">
                {t("settings.postProcessing.prompts.cancel")}
              </Button>
            </>
          ) : selectedPrompt ? (
            <>
              <Button
                onClick={handleUpdatePrompt}
                variant="solid"
                size="2"
                disabled={!isDirty || !draftName.trim() || !draftText.trim()}
              >
                {t("settings.postProcessing.prompts.updatePrompt")}
              </Button>
              <Button
                onClick={() => handleDeletePrompt(selectedPrompt.id)}
                variant="outline"
                color="red"
                size="2"
                disabled={prompts.length <= 1}
              >
                {t("settings.postProcessing.prompts.deletePrompt")}
              </Button>
            </>
          ) : null}
        </Flex>
      </SettingContainer>
    </>
  );
};

export const PromptsConfiguration: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Flex direction="column" gap="6" className="max-w-5xl w-full mx-auto">
      <SettingsGroup title={t("settings.postProcessing.prompts.title")}>
        <PostProcessingToggle grouped={true} />
        <SecondaryTranscriptFusion grouped={true} />
        <PromptSettings />
      </SettingsGroup>
    </Flex>
  );
};
