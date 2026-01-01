// PromptsConfiguration - Main component (refactored)
// Refactored to use a Sidebar Layout for better scalability and consistency with ApiSettings

import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
  Slider,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconPicker } from "../../shared/IconPicker";
import { Card } from "../../ui/Card";
import { Dropdown } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { PostProcessingToggle } from "../PostProcessingToggle";
import { SidebarItem } from "./SidebarItem";
import { CommandPrefixes, PromptEditor, TagInput } from "./prompts/components";
import { usePrompts } from "./prompts/hooks/usePrompts";

const PromptsConfiguration: React.FC = () => {
  const { t } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    draftIcon,
    setDraftIcon,
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
    draftComplianceCheck,
    setDraftComplianceCheck,
    draftComplianceThreshold,
    setDraftComplianceThreshold,

    draftOutputMode,
    setDraftOutputMode,
  } = usePrompts();

  // Helper to handle adding a new prompt
  const onAddPrompt = () => {
    setCurrentTab("NEW");
  };

  return (
    <Box className="w-full max-w-5xl mx-auto">
      <Flex direction="column" gap="5">
        {/* Top Section: Global Configuration (全局配置) */}
        <SettingsGroup
          title={t("settings.postProcessing.prompts.globalConfigTitle", {
            defaultValue: "全局配置",
          })}
        >
          <Flex direction="column" gap="2">
            <PostProcessingToggle grouped={true} />

            {enabled && (
              <Box>
                <CommandPrefixes
                  t={t}
                  prefixes={currentPrefixes}
                  currentPrefixInput={currentPrefixInput}
                  setCurrentPrefixInput={setCurrentPrefixInput}
                  onAddPrefix={handleAddPrefix}
                  onRemovePrefix={handleRemovePrefix}
                />
              </Box>
            )}
          </Flex>
        </SettingsGroup>

        {/* Bottom Section: Prompt Management Area */}
        {enabled && (
          <Card className="p-0! overflow-hidden border-gray-100 dark:border-gray-800 shadow-sm rounded-xl">
            <Grid columns="240px 1fr">
              {/* Left Sidebar */}
              <Flex
                direction="column"
                className="min-h-[500px] border-r border-gray-100 dark:border-gray-800"
              >
                <Flex
                  justify="between"
                  align="center"
                  className="pt-5 pb-2 px-4 shrink-0"
                >
                  <Text size="3" weight="bold" color="gray">
                    {t("settings.postProcessing.prompts.managementTitle", {
                      defaultValue: "提示词管理",
                    })}
                  </Text>
                  <IconButton
                    variant="soft"
                    color="gray"
                    size="2"
                    onClick={onAddPrompt}
                    className="cursor-pointer"
                    title={t("settings.postProcessing.prompts.createNew")}
                  >
                    <IconPlus size={16} />
                  </IconButton>
                </Flex>
                <Box className="flex-1 overflow-y-auto px-2 space-y-0.5">
                  {prompts.map((prompt) => (
                    <SidebarItem
                      key={prompt.id}
                      option={{ value: prompt.id, label: prompt.name }}
                      isActive={activePromptId === prompt.id}
                      isSelected={currentTab === prompt.id}
                      isBuiltin={false}
                      isVerified={false}
                      onClick={() => setCurrentTab(prompt.id)}
                      onActivate={() => handleSetAsActive()}
                      t={t}
                      icon={prompt.icon || "IconWand"}
                      outputMode={prompt.output_mode}
                    />
                  ))}
                  {/* Temporary item for NEW prompt being created */}
                  {isCreating && (
                    <SidebarItem
                      option={{
                        value: "NEW",
                        label:
                          draftName ||
                          t("settings.postProcessing.prompts.newPromptName", {
                            defaultValue: "新提示词",
                          }),
                      }}
                      isActive={false}
                      isSelected={true}
                      isBuiltin={false}
                      isVerified={false}
                      onClick={() => {}}
                      onActivate={() => {}}
                      t={t}
                      icon={draftIcon || "IconSparkles"}
                      outputMode={draftOutputMode}
                    />
                  )}
                </Box>
              </Flex>

              {/* Right Content Area */}
              <Flex direction="column">
                {/* Header - Compressed Height */}
                <Box className="py-2.5 px-8 shrink-0 border-b border-gray-100 dark:border-gray-800">
                  <Flex direction="column" gap="2">
                    <Flex justify="between" align="center" width="100%">
                      <Flex align="center" gap="3" className="flex-1">
                        <IconPicker
                          value={draftIcon || "IconWand"}
                          onChange={(icon: string) => setDraftIcon(icon)}
                        />
                        <TextField.Root
                          size="3"
                          className="flex-1 max-w-sm bg-transparent! border-0! shadow-none! font-bold text-xl focus-within:ring-0!"
                          placeholder={t(
                            "settings.postProcessing.prompts.promptLabelPlaceholder",
                          )}
                          value={draftName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setDraftName(e.target.value)
                          }
                        />
                      </Flex>

                      <Flex gap="3" align="center">
                        <IconButton
                          variant="ghost"
                          color="gray"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="cursor-pointer opacity-60 hover:opacity-100"
                          title={t(
                            "settings.postProcessing.prompts.advancedSettings",
                          )}
                        >
                          <IconChevronDown
                            size={18}
                            style={{
                              transform: showAdvanced
                                ? "rotate(180deg)"
                                : "none",
                              transition: "transform 0.2s",
                            }}
                          />
                        </IconButton>

                        {!isCreating && prompts.length > 1 && (
                          <Dialog.Root
                            open={showDeleteConfirm}
                            onOpenChange={setShowDeleteConfirm}
                          >
                            <Dialog.Trigger>
                              <IconButton
                                variant="ghost"
                                color="red"
                                className="cursor-pointer"
                                title={t(
                                  "settings.postProcessing.prompts.deletePrompt",
                                )}
                              >
                                <IconTrash size={18} />
                              </IconButton>
                            </Dialog.Trigger>
                            <Dialog.Content maxWidth="450px">
                              <Dialog.Title>
                                {t(
                                  "settings.postProcessing.prompts.deleteConfirm.title",
                                )}
                              </Dialog.Title>
                              <Dialog.Description size="2" mb="4">
                                {t(
                                  "settings.postProcessing.prompts.deleteConfirm.description",
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
                                    onClick={() => {
                                      handleDelete();
                                      setShowDeleteConfirm(false);
                                    }}
                                  >
                                    {t("common.delete")}
                                  </Button>
                                </Dialog.Close>
                              </Flex>
                            </Dialog.Content>
                          </Dialog.Root>
                        )}

                        <Button
                          variant="solid"
                          onClick={handleSave}
                          disabled={
                            !isDirty ||
                            !draftName.trim() ||
                            !draftContent.trim()
                          }
                          className="cursor-pointer"
                        >
                          <IconDeviceFloppy size={18} />
                          {t("common.save")}
                        </Button>
                      </Flex>
                    </Flex>

                    {/* Collapsible Advanced Settings - No Card, inline flow */}
                    {showAdvanced && (
                      <Grid columns="2" gap="4" className="pt-2">
                        {/* 1. Model */}
                        <Box>
                          <label className="text-xs font-semibold text-gray-500 mb-1 block uppercase tracking-wider">
                            {t("settings.postProcessing.api.model.title")}
                          </label>
                          <Dropdown
                            options={textModels}
                            selectedValue={draftModelId || "default"}
                            onSelect={(val) =>
                              setDraftModelId(val === "default" ? null : val)
                            }
                            className="w-full"
                          />
                        </Box>

                        {/* 2. Output Mode - SegmentedControl */}
                        <Box>
                          <label className="text-xs font-semibold text-gray-500 mb-1 block uppercase tracking-wider">
                            {t(
                              "settings.postProcessing.prompts.outputMode.label",
                            )}
                          </label>
                          <SegmentedControl.Root
                            value={draftOutputMode}
                            onValueChange={(val) =>
                              setDraftOutputMode(val as any)
                            }
                            size="1"
                          >
                            <SegmentedControl.Item value="polish">
                              {t(
                                "settings.postProcessing.prompts.outputMode.polish",
                              )}
                            </SegmentedControl.Item>
                            <SegmentedControl.Item value="chat">
                              {t(
                                "settings.postProcessing.prompts.outputMode.chat",
                              )}
                            </SegmentedControl.Item>
                          </SegmentedControl.Root>
                        </Box>

                        {/* 3. Aliases */}
                        <Box>
                          <label className="text-xs font-semibold text-gray-500 mb-1 block uppercase tracking-wider">
                            {t("settings.postProcessing.prompts.aliasesLabel", {
                              defaultValue: "别名",
                            })}
                          </label>
                          <TagInput
                            tags={currentAliases}
                            inputValue={currentAliasInput}
                            onInputChange={setCurrentAliasInput}
                            onAdd={handleAddAlias}
                            onRemove={handleRemoveAlias}
                            onKeyDown={(e: React.KeyboardEvent) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddAlias();
                              }
                            }}
                            placeholder={t(
                              "settings.postProcessing.prompts.aliasPlaceholder",
                            )}
                            emptyMessage={t(
                              "settings.postProcessing.prompts.noAliases",
                            )}
                            error={aliasError}
                          />
                        </Box>

                        {/* 4. Compliance (only for polish mode) - Single row */}
                        {draftOutputMode === "polish" && (
                          <Box>
                            <label className="text-xs font-semibold text-gray-500 mb-1 block uppercase tracking-wider">
                              {t(
                                "settings.postProcessing.prompts.enableReview",
                                { defaultValue: "启用审查触发" },
                              )}
                            </label>
                            <Flex align="center" gap="3" className="mt-1.5">
                              <Switch
                                size="1"
                                checked={draftComplianceCheck}
                                onCheckedChange={setDraftComplianceCheck}
                                className="cursor-pointer shrink-0"
                              />
                              {draftComplianceCheck && (
                                <>
                                  <Slider
                                    value={[draftComplianceThreshold]}
                                    onValueChange={(val: number[]) =>
                                      setDraftComplianceThreshold(val[0])
                                    }
                                    min={0}
                                    max={100}
                                    step={5}
                                    size="1"
                                    className="flex-1 min-w-20"
                                  />
                                  <Text
                                    size="1"
                                    weight="medium"
                                    className="shrink-0 w-10 text-right tabular-nums"
                                  >
                                    {draftComplianceThreshold}%
                                  </Text>
                                </>
                              )}
                            </Flex>
                          </Box>
                        )}
                      </Grid>
                    )}
                  </Flex>
                </Box>

                {/* Editor Content - Expands with content */}
                <Box className="px-8 py-4">
                  <PromptEditor
                    t={t}
                    draftContent={draftContent}
                    setDraftContent={setDraftContent}
                  />
                </Box>
              </Flex>
            </Grid>
          </Card>
        )}
      </Flex>
    </Box>
  );
};

export { PromptsConfiguration };
