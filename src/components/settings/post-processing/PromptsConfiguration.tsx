// PromptsConfiguration - Main component (refactored)
// Refactored to use a Sidebar Layout for better scalability and consistency with ApiSettings

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Box,
  Button,
  Dialog,
  DropdownMenu,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
  Slider,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconFolder,
  IconPlus,
  IconSparkles,
  IconStar,
  IconTrash,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IconPicker } from "../../shared/IconPicker";
import { Card } from "../../ui/Card";
import { Dropdown } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { PostProcessingToggle } from "../PostProcessingToggle";
import { IntentModelSelection } from "./IntentModelSelection";
import { SidebarItem } from "./SidebarItem";
import {
  CommandPrefixes,
  PromptEditor,
  ResizableEditor,
} from "./prompts/components";
import type { SkillTemplate } from "./prompts/hooks/useExternalSkills";
import { useExternalSkills } from "./prompts/hooks/useExternalSkills";
import { usePrompts } from "./prompts/hooks/usePrompts";

const PromptsConfiguration: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [isDescriptionGenerating, setIsDescriptionGenerating] = useState(false);

  // All skills from ~/.votype/skills/ (unified source)
  const {
    externalSkills: fileSkills,
    isLoading: isLoadingSkills,
    refreshExternalSkills: refreshSkills,
    openSkillsFolder,
    createSkillFromTemplate,
    getSkillTemplates,
    reorderSkills,
  } = useExternalSkills();

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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
    draftDescription,
    setDraftDescription,
    draftModelId,
    setDraftModelId,
    draftIcon,
    setDraftIcon,
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
    isSaving,
    draftComplianceCheck,
    setDraftComplianceCheck,
    draftComplianceThreshold,
    setDraftComplianceThreshold,

    draftOutputMode,
    setDraftOutputMode,
    isSuggestingAliases,
    handleSuggestAliases,
  } = usePrompts(fileSkills, async (skillId: string) => {
    // After saving an external skill, refresh the list
    await refreshSkills();
    // Find and return the updated skill
    const updated = fileSkills.find((s) => s.id === skillId);
    return updated || null;
  });

  // All skills now come from file system only - no more merging with settings
  const allSkills = fileSkills;

  // Load templates on mount
  React.useEffect(() => {
    getSkillTemplates().then(setTemplates);
  }, [getSkillTemplates]);

  // Handle creating skill from template
  const handleCreateFromTemplate = async (templateId: string) => {
    setShowTemplateMenu(false);
    const newSkill = await createSkillFromTemplate(templateId);
    if (newSkill) {
      setCurrentTab(newSkill.id);
    }
  };

  return (
    <Box className="w-full max-w-5xl mx-auto">
      <Flex direction="column" gap="5">
        {/* Top Section: Global Configuration (全局配置) */}
        <SettingsGroup
          title={t("settings.postProcessing.prompts.globalConfigTitle")}
        >
          <Flex direction="column" gap="2">
            <PostProcessingToggle grouped={true} />
            <IntentModelSelection />
          </Flex>
        </SettingsGroup>

        {/* Bottom Section: Skill Management Area - Unified View */}
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
                  <Flex gap="2" align="center">
                    <Text size="3" weight="bold" color="gray">
                      {t("settings.postProcessing.prompts.managementTitle")}
                    </Text>
                    <IconButton
                      variant="ghost"
                      color="gray"
                      size="1"
                      onClick={openSkillsFolder}
                      className="cursor-pointer"
                      title={t("settings.postProcessing.skills.openFolder")}
                    >
                      <IconFolder size={14} />
                    </IconButton>
                  </Flex>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <IconButton
                        variant="soft"
                        color="gray"
                        size="1"
                        className="cursor-pointer"
                        title={t("settings.postProcessing.prompts.createNew")}
                      >
                        <IconPlus size={14} />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content variant="soft" size="2">
                      {templates.map((template) => (
                        <DropdownMenu.Item
                          key={template.id}
                          onClick={() => handleCreateFromTemplate(template.id)}
                        >
                          {template.name}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Flex>
                <Box className="flex-1 overflow-y-auto px-2 space-y-0.5">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event: DragEndEvent) => {
                      const { active, over } = event;
                      if (over && active.id !== over.id) {
                        const oldIndex = allSkills.findIndex(
                          (s) => s.id === active.id,
                        );
                        const newIndex = allSkills.findIndex(
                          (s) => s.id === over.id,
                        );
                        if (oldIndex !== -1 && newIndex !== -1) {
                          const newOrder = arrayMove(
                            allSkills.map((s) => s.id),
                            oldIndex,
                            newIndex,
                          );
                          reorderSkills(newOrder);
                        }
                      }
                    }}
                  >
                    <SortableContext
                      items={allSkills.map((s) => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {allSkills.map((skill) => (
                        <SidebarItem
                          key={skill.id}
                          id={skill.id}
                          sortable
                          option={{ value: skill.id, label: skill.name }}
                          isActive={activePromptId === skill.id}
                          isSelected={currentTab === skill.id}
                          isVerified={false}
                          onClick={() => setCurrentTab(skill.id)}
                          onActivate={() => handleSetAsActive()}
                          t={t}
                          icon={skill.icon || "IconWand"}
                          outputMode={skill.output_mode}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                  {/* Temporary item for NEW prompt being created */}
                  {isCreating && (
                    <SidebarItem
                      option={{
                        value: "NEW",
                        label:
                          draftName ||
                          t("settings.postProcessing.prompts.newPromptName"),
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
                  <Flex direction="column" gap="1">
                    <Flex justify="between" align="center" width="100%">
                      <Flex align="center" gap="2" className="flex-1">
                        <IconPicker
                          value={draftIcon || "IconWand"}
                          onChange={(icon: string) => setDraftIcon(icon)}
                        />
                        <TextField.Root
                          size="2"
                          className="flex-1 max-w-sm bg-transparent! border-0! shadow-none! font-semibold text-lg focus-within:ring-0!"
                          placeholder={t(
                            "settings.postProcessing.prompts.promptLabelPlaceholder",
                          )}
                          value={draftName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setDraftName(e.target.value)
                          }
                        />
                      </Flex>

                      <Flex gap="2" align="center">
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="cursor-pointer opacity-60 hover:opacity-100"
                          title={t(
                            "settings.postProcessing.prompts.advancedSettings",
                          )}
                        >
                          <IconChevronDown
                            size={16}
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
                                size="1"
                                className="cursor-pointer"
                                title={t(
                                  "settings.postProcessing.prompts.deletePrompt",
                                )}
                              >
                                <IconTrash size={16} />
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

                        {!isCreating && currentTab !== activePromptId && (
                          <Button
                            variant="soft"
                            size="1"
                            onClick={handleSetAsActive}
                            className="cursor-pointer"
                          >
                            <IconStar size={14} />
                            {t("settings.postProcessing.prompts.setAsActive")}
                          </Button>
                        )}

                        <Button
                          variant="solid"
                          size="1"
                          onClick={handleSave}
                          loading={isSaving}
                          disabled={
                            !isDirty ||
                            !(draftName || "").trim() ||
                            !(draftContent || "").trim()
                          }
                          className="cursor-pointer"
                        >
                          <IconDeviceFloppy size={14} />
                          {t("common.save")}
                        </Button>
                      </Flex>
                    </Flex>

                    {/* Collapsible Advanced Settings - No Card, inline flow */}
                    {showAdvanced && (
                      <Flex direction="column" gap="3" className="pt-2">
                        <Grid columns="2" gap="4">
                          {/* 1. Model */}
                          <Box>
                            <label className="text-xs font-medium text-gray-500 mb-1 block">
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
                            <label className="text-xs font-medium text-gray-500 mb-1 block">
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

                          {/* 4. Compliance (only for polish mode) - Single row */}
                          {draftOutputMode === "polish" && (
                            <Box>
                              <label className="text-xs font-medium text-gray-500 mb-1 block">
                                {t(
                                  "settings.postProcessing.prompts.enableReview",
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
                      </Flex>
                    )}
                  </Flex>
                </Box>

                {/* Editor Content - Expands with content */}
                <Box className="px-8 py-5">
                  <Flex direction="column" gap="5">
                    {/* Description Section - v3 Improvements */}
                    <Flex direction="column" gap="2">
                      <Flex justify="between" align="center">
                        <label className="text-xs font-semibold text-gray-500/80">
                          {t("settings.postProcessing.prompts.description")}
                        </label>

                        {/* Magic Generator Button on the right of the title */}
                        <Tooltip content={t("common.aiOptimize")}>
                          <IconButton
                            variant="soft"
                            color="gray"
                            size="1"
                            loading={isDescriptionGenerating}
                            className="cursor-pointer"
                            onClick={async () => {
                              if (!draftName || !draftContent) {
                                toast.error(
                                  "建议先填写名称和指令，以便 AI 更好地总结。",
                                );
                                return;
                              }
                              setIsDescriptionGenerating(true);
                              try {
                                const desc = await invoke<string>(
                                  "generate_skill_description",
                                  {
                                    name: draftName,
                                    instructions: draftContent,
                                    locale: i18n.language,
                                  },
                                );
                                setDraftDescription(desc);
                                toast.success(
                                  t("common.aiOptimizationSuccess"),
                                );
                              } catch (e) {
                                toast.error(t("common.aiOptimizationFailed"));
                                console.error(e);
                              } finally {
                                setIsDescriptionGenerating(false);
                              }
                            }}
                          >
                            <IconSparkles size={14} />
                          </IconButton>
                        </Tooltip>
                      </Flex>

                      <ResizableEditor
                        value={draftDescription}
                        onChange={setDraftDescription}
                        label={t("settings.postProcessing.prompts.description")}
                        placeholder={t(
                          "settings.postProcessing.prompts.descriptionPlaceholder",
                        )}
                        minHeight={40}
                        defaultHeight={40}
                        autoHeight={true}
                        maxAutoLines={4}
                        loading={isDescriptionGenerating}
                        hideTips={true}
                        showToolbar={false}
                        showLabel={false}
                        className="w-full"
                      />
                    </Flex>

                    {/* Instructions Section */}
                    <Box>
                      <PromptEditor
                        t={t}
                        draftContent={draftContent}
                        setDraftContent={setDraftContent}
                      />
                    </Box>

                    {/* Alias / Command Prefix Section - Added back */}
                    <Box className="pt-2 border-t border-gray-100 dark:border-gray-800">
                      <CommandPrefixes
                        t={t}
                        prefixes={currentAliases}
                        currentPrefixInput={currentAliasInput}
                        setCurrentPrefixInput={setCurrentAliasInput}
                        onAddPrefix={handleAddAlias}
                        onRemovePrefix={handleRemoveAlias}
                      />
                      {aliasError && (
                        <Text color="red" size="1" className="mt-1 block">
                          {aliasError}
                        </Text>
                      )}
                    </Box>
                  </Flex>
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
