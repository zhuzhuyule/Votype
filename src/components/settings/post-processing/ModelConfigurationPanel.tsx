import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useMemo, useState } from "react";
import { EditModelDialog } from "./dialogs/EditModelDialog";
import { useSettingsStore } from "../../../stores/settingsStore";

import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Checkbox,
  Dialog,
  Flex,
  IconButton,
  SegmentedControl,
  Switch,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  IconBrain,
  IconCircleCheckFilled,
  IconEdit,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel, ModelType } from "../../../lib/types";

// Helper to render a section of models
const renderModelSection = ({
  type,
  allModels,
  providerMap,
  settings,
  isUpdating,
  handleRemove,
  t,
  refreshSettings,
  allowSelection,
  contentStyle = "",
  hideIfEmpty = true,
  multiModelSelectedIds,
  onToggleMultiModel,
  onEditModel,
}: {
  type: ModelType;
  allModels: CachedModel[];
  providerMap: Record<string, string>;
  settings: any;
  isUpdating: (id: string) => boolean;
  handleRemove: (id: string) => void;
  t: any;
  refreshSettings: () => Promise<void>;
  allowSelection: boolean;
  headerStyle?: string;
  contentStyle?: string;
  hideIfEmpty?: boolean;
  multiModelSelectedIds?: Set<string>;
  onToggleMultiModel?: (id: string, selected: boolean) => void;
  onEditModel?: (model: CachedModel) => void;
}) => {
  const models = allModels.filter((m) => m.model_type === type);

  if (hideIfEmpty && models.length === 0) {
    return (
      <Flex
        align="center"
        justify="center"
        p="4"
        className="bg-gray-50/50 rounded-lg border border-dashed border-gray-200"
      >
        <Text size="1" color="gray" className="opacity-70">
          {t("settings.postProcessing.models.empty.description")}
        </Text>
      </Flex>
    );
  }

  // Group models by provider
  const groupedModels: Record<string, CachedModel[]> = {};
  models.forEach((model) => {
    const providerKey = model.provider_id;
    if (!groupedModels[providerKey]) {
      groupedModels[providerKey] = [];
    }
    groupedModels[providerKey].push(model);
  });

  return (
    <Flex direction="column" className="h-full">
      <Box className={`space-y-4 flex-1 ${contentStyle}`}>
        {Object.entries(groupedModels).map(
          ([providerId, providerModels], index) => (
            <Box
              key={providerId}
              className={
                index > 0
                  ? "mt-4 pt-4 border-t border-gray-100 dark:border-white/10"
                  : ""
              }
            >
              {/* Minimal Provider Header - Uppercase small label */}
              <Text
                size="1"
                weight="bold"
                className="px-1 mb-2 block uppercase text-xs opacity-60 tracking-wider text-gray-500 dark:text-gray-400"
              >
                {providerMap[providerId] ?? providerId}
              </Text>

              {/* Models list for this provider */}
              <Box className="">
                {providerModels.map((model, index) => {
                  const isRemoving = isUpdating(
                    `cached_model_remove:${model.id}`,
                  );
                  const isSelected =
                    allowSelection &&
                    settings?.selected_prompt_model_id === model.id;

                  return (
                    <Flex
                      key={model.id}
                      align="center"
                      justify="between"
                      className={`
                      px-2 py-2 transition-colors cursor-pointer group rounded-md
                      ${isSelected ? "bg-indigo-50/50 dark:bg-indigo-500/20" : "hover:bg-gray-100/50 dark:hover:bg-white/5"}
                    `}
                      onClick={async () => {
                        if (allowSelection && !isRemoving) {
                          try {
                            await invoke("select_post_process_model", {
                              modelId: model.id,
                            });
                            await refreshSettings();
                          } catch (e) {
                            console.error(e);
                          }
                        }
                      }}
                    >
                      <Flex align="center" gap="3" className="flex-1 min-w-0">
                        {/* Multi-model checkbox for text models */}
                        {type === "text" &&
                          multiModelSelectedIds &&
                          onToggleMultiModel && (
                            <Checkbox
                              checked={multiModelSelectedIds.has(model.id)}
                              onCheckedChange={(checked) => {
                                onToggleMultiModel(model.id, !!checked);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        <Box className="flex-1 min-w-0">
                          <Flex align="center" gap="2" wrap="wrap">
                            <Text
                              size="2"
                              weight={isSelected ? "bold" : "medium"}
                              className="text-gray-900 dark:text-gray-200 truncate block leading-snug"
                            >
                              {model.custom_label || model.model_id}
                            </Text>
                            {model.custom_label && (
                              <Badge
                                size="1"
                                color="gray"
                                variant="soft"
                                radius="full"
                              >
                                {model.model_id}
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge
                                size="1"
                                variant="solid"
                                className="bg-(--accent-a3) text-(--accent-11) uppercase font-bold tracking-wider rounded"
                              >
                                {t("common.default", "默认")}
                              </Badge>
                            )}
                          </Flex>
                        </Box>
                        {model.is_thinking_model && (
                          <IconBrain
                            size={14}
                            className="text-purple-500 ml-1 shrink-0"
                          />
                        )}
                      </Flex>
                      {/* Actions - Visible on Hover */}
                      <Flex
                        gap="3"
                        align="center"
                        className="opacity-0 group-hover:opacity-100 transition-opacity pl-2"
                      >
                        {allowSelection && !isSelected && (
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            className="cursor-pointer"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!isRemoving) {
                                try {
                                  await invoke("select_post_process_model", {
                                    modelId: model.id,
                                  });
                                  await refreshSettings();
                                } catch (e) {
                                  console.error(e);
                                }
                              }
                            }}
                          >
                            <IconCircleCheckFilled size={14} />
                            {t(
                              "settings.postProcessing.models.setAsDefault",
                              "Set as Default",
                            )}
                          </Button>
                        )}
                        <IconButton
                          size="1"
                          variant="ghost"
                          color="green"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const toastId = toast.loading(
                              t(
                                "settings.postProcessing.api.providers.api.testing",
                              ),
                            );
                            try {
                              // Choose the appropriate test command based on model type
                              const isAsrModel = model.model_type === "asr";
                              const result = isAsrModel
                                ? await invoke<string>(
                                    "test_asr_model_inference",
                                    {
                                      modelId: model.model_id,
                                    },
                                  )
                                : await invoke<any>(
                                    "test_post_process_model_inference",
                                    {
                                      providerId: model.provider_id,
                                      modelId: model.model_id,
                                      cachedModelId: model.id,
                                      input: "OK", // Simple input for text models
                                    },
                                  );

                              const resultObj = isAsrModel
                                ? ({ content: result as string } as const)
                                : (result as {
                                    content: string;
                                    reasoning_content?: string;
                                  });

                              const mainContent = resultObj.content || "";
                              const hasThinking =
                                ("reasoning_content" in resultObj &&
                                  !!resultObj.reasoning_content) ||
                                mainContent.includes("<think>");

                              toast.dismiss(toastId);

                              const modelLabel =
                                model.custom_label?.trim() ||
                                model.name?.trim() ||
                                model.model_id;

                              const successMessage = t(
                                "settings.postProcessing.api.providers.api.testSuccess",
                                {
                                  result: hasThinking
                                    ? `[Thinking] ${mainContent}`
                                    : mainContent,
                                },
                              );

                              toast.success(
                                `${successMessage} (${modelLabel})`,
                                {
                                  duration: 5000,
                                  closeButton: true,
                                },
                              );
                            } catch (error) {
                              toast.dismiss(toastId);
                              let errorMessage = String(error);
                              // Simple normalization if it's an object/error instance
                              if (error instanceof Error)
                                errorMessage = error.message;

                              toast.error(
                                t(
                                  "settings.postProcessing.api.providers.testFailed",
                                  {
                                    error: errorMessage,
                                  },
                                ),
                                {
                                  duration: Infinity,
                                  closeButton: true,
                                  style: { color: "red" },
                                },
                              );
                            }
                          }}
                          title={t(
                            "settings.postProcessing.api.providers.testConnection",
                          )}
                        >
                          <IconPlayerPlay size={14} />
                        </IconButton>

                        {onEditModel && (
                          <IconButton
                            size="1"
                            variant="ghost"
                            color="gray"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditModel(model);
                            }}
                            title={t("common.edit", "Edit")}
                          >
                            <IconEdit size={14} />
                          </IconButton>
                        )}

                        <AlertDialog.Root>
                          <AlertDialog.Trigger>
                            <IconButton
                              size="1"
                              variant="ghost"
                              color="red"
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              disabled={!!isRemoving}
                              title={t("common.delete")}
                            >
                              <IconTrash size={14} />
                            </IconButton>
                          </AlertDialog.Trigger>
                          <AlertDialog.Content
                            maxWidth="450px"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <AlertDialog.Title>
                              {t(
                                "settings.postProcessing.models.deleteConfirm.title",
                              )}
                            </AlertDialog.Title>
                            <AlertDialog.Description size="2">
                              {t(
                                "settings.postProcessing.models.deleteConfirm.description",
                              )}
                            </AlertDialog.Description>
                            <Flex gap="3" mt="4" justify="end">
                              <AlertDialog.Cancel>
                                <Button variant="soft" color="gray">
                                  {t("common.cancel")}
                                </Button>
                              </AlertDialog.Cancel>
                              <AlertDialog.Action>
                                <Button
                                  variant="solid"
                                  color="red"
                                  onClick={(e) => {
                                    e.stopPropagation(); // Just in case
                                    handleRemove(model.id);
                                  }}
                                >
                                  {t("common.delete")}
                                </Button>
                              </AlertDialog.Action>
                            </Flex>
                          </AlertDialog.Content>
                        </AlertDialog.Root>
                      </Flex>
                    </Flex>
                  );
                })}
              </Box>
            </Box>
          ),
        )}
      </Box>
    </Flex>
  );
};

export interface ModelListPanelProps {
  targetType: ModelType | ModelType[];
  allowSelection?: boolean;
  showMultiModelCheckboxes?: boolean;
  onAddModel?: () => void;
  showTypeFilter?: boolean;
}

export const ModelListPanel: React.FC<ModelListPanelProps> = ({
  targetType,
  allowSelection: allowSelectionProp,
  showMultiModelCheckboxes: showMultiModelCheckboxesProp,
  onAddModel,
  showTypeFilter,
}) => {
  const { settings, removeCachedModel, isUpdating, refreshSettings } =
    useSettings();
  const { toggleMultiModelSelection } = useSettingsStore();

  // Edit model dialog state
  const [editingModel, setEditingModel] = useState<CachedModel | null>(null);

  // Type filter state
  const [activeFilter, setActiveFilter] = useState<"all" | ModelType>("all");

  const { t } = useTranslation();
  const cachedModels = settings?.cached_models ?? [];

  const multiModelSelectedIds = useMemo(
    () => new Set(settings?.multi_model_selected_ids ?? []),
    [settings?.multi_model_selected_ids],
  );

  const handleToggleMultiModel = useCallback(
    async (id: string, selected: boolean) => {
      await toggleMultiModelSelection(id, selected);
    },
    [toggleMultiModelSelection],
  );

  const providerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers.forEach((provider) => {
      map[provider.id] = provider.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const handleRemoveModel = useCallback(
    async (modelId: string) => {
      await removeCachedModel(modelId);
    },
    [removeCachedModel],
  );

  const typesToRender = Array.isArray(targetType) ? targetType : [targetType];

  const filteredTypes = useMemo(() => {
    if (!showTypeFilter || activeFilter === "all") {
      return typesToRender;
    }
    if (activeFilter === "asr") {
      return typesToRender.filter((t) => t === "asr" || t === "other");
    }
    return typesToRender.filter((t) => t === activeFilter);
  }, [showTypeFilter, activeFilter, typesToRender]);

  return (
    <Box>
      {showTypeFilter && (
        <Flex align="center" justify="between" mb="3">
          <SegmentedControl.Root
            value={activeFilter}
            onValueChange={(v) => setActiveFilter(v as "all" | ModelType)}
            size="1"
          >
            <SegmentedControl.Item value="all">
              {t("settings.postProcessing.models.filter.all")}
            </SegmentedControl.Item>
            <SegmentedControl.Item value="text">
              {t("settings.postProcessing.models.modelTypes.text.label")}
            </SegmentedControl.Item>
            <SegmentedControl.Item value="asr">
              {t("settings.postProcessing.models.modelTypes.asr.label")}
            </SegmentedControl.Item>
          </SegmentedControl.Root>
          {onAddModel && (
            <Button variant="outline" size="1" onClick={onAddModel}>
              <IconPlus size={14} />
              {t("settings.postProcessing.models.selectModel.addButton")}
            </Button>
          )}
        </Flex>
      )}
      {filteredTypes.map((type) => (
        <Box key={type} className="mb-4 last:mb-0">
          {renderModelSection({
            type,
            allModels: cachedModels,
            providerMap: providerNameMap,
            settings,
            isUpdating,
            handleRemove: handleRemoveModel,
            t,
            refreshSettings,
            allowSelection:
              allowSelectionProp !== undefined
                ? allowSelectionProp
                : type === "text",
            hideIfEmpty: false,
            multiModelSelectedIds:
              type === "text" &&
              (showMultiModelCheckboxesProp ??
                settings?.multi_model_post_process_enabled)
                ? multiModelSelectedIds
                : undefined,
            onToggleMultiModel:
              type === "text" &&
              (showMultiModelCheckboxesProp ??
                settings?.multi_model_post_process_enabled)
                ? handleToggleMultiModel
                : undefined,
            onEditModel: setEditingModel,
          })}
        </Box>
      ))}
      {editingModel && (
        <EditModelDialog
          model={editingModel}
          onClose={() => setEditingModel(null)}
          onSave={async () => {
            await refreshSettings();
            setEditingModel(null);
          }}
        />
      )}
    </Box>
  );
};

ModelListPanel.displayName = "ModelListPanel";
