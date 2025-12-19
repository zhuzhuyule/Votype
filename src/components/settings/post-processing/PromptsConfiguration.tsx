// PromptsConfiguration - Main component (refactored)
// This component orchestrates the prompts configuration using extracted components and hooks

import { Box, Button, Flex, Heading, Tabs } from "@radix-ui/themes";
import { IconCheck, IconDeviceFloppy, IconPlus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { PostProcessingToggle } from "../PostProcessingToggle";
import {
  CommandPrefixes,
  DeletePromptDialog,
  PromptEditor,
} from "./prompts/components";
import { usePrompts } from "./prompts/hooks/usePrompts";

const PromptsConfiguration: React.FC = () => {
  const { t } = useTranslation();

  const {
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
    draftModelId,
    setDraftModelId,
    currentAliases,
    currentAliasInput,
    setCurrentAliasInput,
    aliasError,
    setAliasError,
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
  } = usePrompts();

  return (
    <Flex direction="column" gap="5" className="max-w-5xl w-full mx-auto">
      <SettingsGroup title={t("settings.postProcessing.prompts.title")}>
        <PostProcessingToggle grouped={true} />

        {enabled && (
          <Box pb="2">
            {/* Command Prefixes Configuration */}
            <CommandPrefixes
              t={t}
              prefixes={currentPrefixes}
              currentPrefixInput={currentPrefixInput}
              setCurrentPrefixInput={setCurrentPrefixInput}
              onAddPrefix={handleAddPrefix}
              onRemovePrefix={handleRemovePrefix}
            />

            <Tabs.Root
              value={currentTab}
              onValueChange={setCurrentTab}
              className="pt-4"
            >
              <Tabs.List>
                {prompts.map((prompt) => (
                  <Tabs.Trigger
                    key={prompt.id}
                    value={prompt.id}
                    className="relative pr-6"
                  >
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
                {/* New Prompt Trigger */}
                <Tabs.Trigger value="NEW" style={{ padding: "0 12px" }}>
                  <IconPlus size={16} />
                </Tabs.Trigger>
              </Tabs.List>

              <Box pt="4">
                <Flex direction="column" gap="4">
                  {/* Toolbar / Header */}
                  <Flex justify="between" align="center">
                    <Heading size="3">
                      {isCreating
                        ? t("settings.postProcessing.prompts.createPrompt")
                        : t("settings.postProcessing.prompts.editPrompt")}
                    </Heading>
                    <Flex gap="3">
                      {!isCreating &&
                        viewingPrompt &&
                        activePromptId !== viewingPrompt.id && (
                          <Button variant="outline" onClick={handleSetAsActive}>
                            {t("settings.postProcessing.prompts.setAsActive")}
                          </Button>
                        )}
                      {!isCreating && (
                        <DeletePromptDialog
                          t={t}
                          onDelete={handleDelete}
                          disabled={prompts.length <= 1 && !isCreating}
                        />
                      )}
                      <Button
                        variant="solid"
                        onClick={handleSave}
                        disabled={
                          !isDirty || !draftName.trim() || !draftContent.trim()
                        }
                      >
                        <IconDeviceFloppy size={18} />
                        {t("common.save")}
                      </Button>
                    </Flex>
                  </Flex>

                  {/* Prompt Editor Form */}
                  <PromptEditor
                    t={t}
                    draftName={draftName}
                    setDraftName={setDraftName}
                    draftContent={draftContent}
                    setDraftContent={setDraftContent}
                    draftModelId={draftModelId}
                    setDraftModelId={setDraftModelId}
                    currentAliases={currentAliases}
                    currentAliasInput={currentAliasInput}
                    setCurrentAliasInput={setCurrentAliasInput}
                    aliasError={aliasError}
                    setAliasError={setAliasError}
                    onAddAlias={handleAddAlias}
                    onRemoveAlias={handleRemoveAlias}
                    textModels={textModels}
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

export { PromptsConfiguration };
