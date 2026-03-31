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
  Grid,
  IconButton,
  Switch,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconBrain,
  IconCircleCheckFilled,
  IconEdit,
  IconPlayerPlay,
  IconTag,
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
  preferredProviderId,
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
  preferredProviderId?: string;
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
  const models = allModels.filter(
    (m) => m.model_type === type && providerMap[m.provider_id] !== undefined,
  );

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

  const orderedGroups = Object.entries(groupedModels).sort(
    ([left], [right]) => {
      if (left === preferredProviderId) return -1;
      if (right === preferredProviderId) return 1;
      return (providerMap[left] ?? left).localeCompare(
        providerMap[right] ?? right,
      );
    },
  );

  return (
    <Flex direction="column" className="h-full">
      <Box className={`space-y-4 flex-1 ${contentStyle}`}>
        {orderedGroups.map(([providerId, providerModels], index) => {
          const isPreferred = providerId === preferredProviderId;
          return (
            <Box
              key={providerId}
              className={`${
                index > 0
                  ? "mt-4 pt-4 border-t border-gray-100 dark:border-white/10"
                  : ""
              } ${isPreferred ? "rounded-lg bg-(--accent-a2) px-2 py-2 -mx-2 ring-1 ring-(--accent-a4)" : ""}`}
            >
              {/* Provider Header */}
              <Text
                size="2"
                weight="bold"
                className="block uppercase tracking-wider text-gray-600 dark:text-gray-300"
                style={{ paddingLeft: 8, marginBottom: 6 }}
              >
                {providerMap[providerId] ?? providerId}
              </Text>

              {/* Models grid for this provider */}
              <Grid columns="2" gap="1">
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
                      relative py-2.5 transition-colors cursor-pointer group rounded-md min-w-0
                      ${isSelected ? "bg-indigo-50/50 dark:bg-indigo-500/20" : "hover:bg-gray-100/50 dark:hover:bg-white/5"}
                    `}
                      style={{ paddingLeft: 8, paddingRight: 8 }}
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
                      <Flex align="center" gap="2" className="flex-1 min-w-0">
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
                        {model.custom_label ? (
                          <Tooltip content={model.model_id} delayDuration={300}>
                            <Flex align="center" gap="1" className="min-w-0">
                              <Text
                                size="2"
                                weight={isSelected ? "bold" : "medium"}
                                className="text-gray-900 dark:text-gray-200 truncate block"
                              >
                                {model.custom_label}
                              </Text>
                              <IconTag
                                size={13}
                                className="text-amber-500 shrink-0"
                              />
                            </Flex>
                          </Tooltip>
                        ) : (
                          <Text
                            size="2"
                            weight={isSelected ? "bold" : "medium"}
                            className="text-gray-900 dark:text-gray-200 truncate block"
                          >
                            {model.model_id}
                          </Text>
                        )}
                        {isSelected && (
                          <Badge
                            size="1"
                            variant="solid"
                            className="bg-(--accent-a3) text-(--accent-11) uppercase font-bold tracking-wider rounded shrink-0"
                          >
                            {t("common.default", "默认")}
                          </Badge>
                        )}
                        {model.is_thinking_model && (
                          <IconBrain
                            size={14}
                            className="text-purple-500 shrink-0"
                          />
                        )}
                      </Flex>
                      {/* Actions - Visible on Hover */}
                      <Flex
                        gap="1"
                        align="center"
                        className="absolute right-1 top-1/2 -translate-y-1/2 invisible group-hover:visible bg-inherit rounded-md px-1 py-0.5"
                      >
                        {allowSelection && !isSelected && (
                          <IconButton
                            size="1"
                            variant="ghost"
                            color="gray"
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
                            title={t(
                              "settings.postProcessing.models.setAsDefault",
                              "Set as Default",
                            )}
                          >
                            <IconCircleCheckFilled size={14} />
                          </IconButton>
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
              </Grid>
            </Box>
          );
        })}
      </Box>
    </Flex>
  );
};

export interface ModelListPanelProps {
  targetType: ModelType | ModelType[];
  allowSelection?: boolean;
  showMultiModelCheckboxes?: boolean;
  activeFilter?: ModelType;
  preferredProviderId?: string;
}

export const ModelListPanel: React.FC<ModelListPanelProps> = ({
  targetType,
  allowSelection: allowSelectionProp,
  showMultiModelCheckboxes: showMultiModelCheckboxesProp,
  activeFilter,
  preferredProviderId,
}) => {
  const { settings, removeCachedModel, isUpdating, refreshSettings } =
    useSettings();
  const { toggleMultiModelSelection } = useSettingsStore();

  // Edit model dialog state
  const [editingModel, setEditingModel] = useState<CachedModel | null>(null);

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
    if (!activeFilter) {
      return typesToRender;
    }
    if (activeFilter === "asr") {
      return typesToRender.filter((t) => t === "asr" || t === "other");
    }
    return typesToRender.filter((t) => t === activeFilter);
  }, [activeFilter, typesToRender]);

  const renderModelsForFilter = () =>
    filteredTypes.map((type) => (
      <Box key={type} className="mb-4 last:mb-0">
        {renderModelSection({
          type,
          allModels: cachedModels,
          providerMap: providerNameMap,
          preferredProviderId,
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
    ));

  return (
    <Box>
      {renderModelsForFilter()}
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
