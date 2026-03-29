import {
  Badge,
  Box,
  Checkbox,
  Dialog,
  Flex,
  Grid,
  ScrollArea,
  Slider as RadixSlider,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconBolt,
  IconBrain,
  IconPlus,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";
import { Dropdown } from "../../ui/Dropdown";
import { TooltipIcon } from "../../ui/TooltipIcon";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel } from "../../../lib/types";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AppProfilesContextSettings } from "./AppProfilesContextSettings";

type ModelMode = "single" | "multi";

interface PostProcessingPanelProps {
  enabled: boolean;
}

export const PostProcessingPanel: React.FC<PostProcessingPanelProps> = ({
  enabled,
}) => {
  const { t } = useTranslation();
  const { settings, updateSetting, selectPromptModel, isUpdating } =
    useSettings();

  const smartRoutingEnabled = settings?.length_routing_enabled ?? false;
  const multiModelEnabled = settings?.multi_model_post_process_enabled ?? false;
  const modelMode: ModelMode = multiModelEnabled ? "multi" : "single";
  const threshold = settings?.length_routing_threshold ?? 100;
  const shortModelId = settings?.length_routing_short_model_id ?? null;
  const defaultModelId = settings?.selected_prompt_model_id ?? null;
  const intentModelId = settings?.post_process_intent_model_id ?? null;
  const multiModelSelectedIds = useMemo(
    () => settings?.multi_model_selected_ids ?? [],
    [settings?.multi_model_selected_ids],
  );
  const multiModelStrategy = settings?.multi_model_strategy ?? "manual";
  const multiModelPreferredId = settings?.multi_model_preferred_id ?? null;

  const textModels: CachedModel[] = useMemo(
    () =>
      (settings?.cached_models ?? []).filter((m) => m.model_type === "text"),
    [settings?.cached_models],
  );

  const providerMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers?.forEach((p) => {
      map[p.id] = p.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const getModelLabel = useCallback(
    (model: CachedModel) => {
      const provider = providerMap[model.provider_id] ?? model.provider_id;
      const name = model.custom_label || model.model_id;
      return `${name} (${provider})`;
    },
    [providerMap],
  );

  const buildModelOptions = useCallback(
    (placeholder?: string) => {
      const options: { value: string; label: string }[] = [];
      if (placeholder) {
        options.push({ value: "__none__", label: placeholder });
      }
      for (const model of textModels) {
        options.push({ value: model.id, label: getModelLabel(model) });
      }
      return options;
    },
    [textModels, getModelLabel],
  );

  const renderModelSelect = useCallback(
    (
      value: string | null,
      onChange: (value: string) => void,
      placeholder?: string,
    ) => (
      <Dropdown
        selectedValue={value ?? "__none__"}
        options={buildModelOptions(placeholder)}
        onSelect={onChange}
        placeholder={placeholder}
        enableFilter={true}
        style={{ maxWidth: 220 }}
      />
    ),
    [buildModelOptions],
  );

  const handleToggle = useCallback(
    (key: "post_process_enabled" | "length_routing_enabled") =>
      async (checked: boolean) => {
        await updateSetting(key, checked);
      },
    [updateSetting],
  );

  const multiStrategyOptions: {
    value: "manual" | "race" | "lazy";
    label: string;
    hint: string;
  }[] = [
    {
      value: "manual",
      label: t(
        "settings.postProcessing.textModelMode.multiStrategyManual",
        "Manual",
      ),
      hint: t(
        "settings.postProcessing.textModelMode.multiStrategyManualHint",
        "Show all candidates for manual selection",
      ),
    },
    {
      value: "race",
      label: t(
        "settings.postProcessing.textModelMode.multiStrategyRaceShort",
        "Race",
      ),
      hint: t(
        "settings.postProcessing.textModelMode.multiStrategyRaceHint",
        "Use the first available result",
      ),
    },
    {
      value: "lazy",
      label: t(
        "settings.postProcessing.textModelMode.multiStrategyLazyShort",
        "Lazy",
      ),
      hint: t(
        "settings.postProcessing.textModelMode.multiStrategyLazyHint",
        "Wait for preferred model, auto-select on timeout",
      ),
    },
  ];

  // ── Model Selection Card ──
  const modelSelectionCard = (
    <Box
      className="rounded-lg border border-(--gray-a4) p-3"
      style={{ background: "var(--gray-a2)" }}
    >
      <Flex direction="column" gap="3">
        {/* Header: icon + label + [Single|Multi] pills */}
        <Flex align="center" justify="between">
          <Flex align="center" gap="2">
            <IconBrain size={15} className="text-(--gray-9)" />
            <Text size="2" weight="medium">
              {smartRoutingEnabled
                ? t(
                    "settings.postProcessing.smartRouting.longText",
                    "Long text",
                  )
                : t(
                    "settings.postProcessing.textModelMode.modelSelection",
                    "Model",
                  )}
            </Text>
            {smartRoutingEnabled && (
              <Text size="1" color="gray">
                &gt; {threshold}
              </Text>
            )}
          </Flex>
          <Flex
            align="center"
            gap="0"
            className="rounded-md bg-(--gray-a3) p-0.5"
          >
            {[
              {
                value: "single" as ModelMode,
                label: t(
                  "settings.postProcessing.textModelMode.single",
                  "Single",
                ),
                hint: t(
                  "settings.postProcessing.textModelMode.singleHint",
                  "Use one model for all text processing",
                ),
              },
              {
                value: "multi" as ModelMode,
                label: t(
                  "settings.postProcessing.textModelMode.multi",
                  "Multi",
                ),
                hint: t(
                  "settings.postProcessing.textModelMode.multiHint",
                  "Run multiple models in parallel for comparison or speed",
                ),
              },
            ].map((m) => (
              <Tooltip key={m.value} content={m.hint}>
                <button
                  type="button"
                  onClick={() => {
                    if (m.value !== modelMode)
                      updateSetting(
                        "multi_model_post_process_enabled",
                        m.value === "multi",
                      );
                  }}
                  className={`rounded-md transition-all duration-200 cursor-pointer whitespace-nowrap ${modelMode === m.value ? "bg-white shadow-sm px-3 py-1 text-xs font-semibold text-(--gray-12)" : "px-2.5 py-1 text-xs font-medium text-(--gray-9) hover:text-(--gray-11)"}`}
                >
                  {m.label}
                </button>
              </Tooltip>
            ))}
          </Flex>
        </Flex>

        {/* Single model */}
        {modelMode === "single" && (
          <Flex align="center" justify="between">
            <Text size="2" weight="medium">
              {t(
                "settings.postProcessing.textModelMode.defaultModelDescription",
                "Default model",
              )}
            </Text>
            <Box style={{ minWidth: 160 }}>
              {renderModelSelect(
                defaultModelId,
                (v) => {
                  if (v && v !== "__none__") selectPromptModel(v);
                },
                t(
                  "settings.postProcessing.textModelMode.noModelSelected",
                  "No model selected",
                ),
              )}
            </Box>
          </Flex>
        )}

        {/* Multi model */}
        {modelMode === "multi" && (
          <Flex direction="column" gap="2">
            {/* Strategy [+]  |  tabs */}
            <Flex align="center" justify="between">
              <Flex align="center" gap="2">
                <Text size="2" weight="medium">
                  {t(
                    "settings.postProcessing.textModelMode.multiStrategy",
                    "Strategy",
                  )}
                </Text>
                <Dialog.Root>
                  <Dialog.Trigger>
                    <button
                      type="button"
                      className="flex items-center justify-center w-5 h-5 rounded border border-(--gray-a6) text-(--gray-11) hover:bg-(--gray-a3) transition-colors cursor-pointer"
                    >
                      <IconPlus size={12} />
                    </button>
                  </Dialog.Trigger>
                  <Dialog.Content
                    style={{
                      maxWidth: 600,
                      width: "90vw",
                      padding: 0,
                      overflow: "hidden",
                    }}
                  >
                    <Box px="5" pt="5" pb="3">
                      <Dialog.Title>
                        {t(
                          "settings.postProcessing.textModelMode.selectModelsTitle",
                          "Select models",
                        )}
                      </Dialog.Title>
                      <Dialog.Description size="2" color="gray">
                        {t(
                          "settings.postProcessing.textModelMode.selectModelsDescription",
                          "Choose models for parallel processing. Click the star to set preferred model.",
                        )}
                      </Dialog.Description>
                    </Box>
                    <ScrollArea
                      style={{
                        maxHeight: "60vh",
                        paddingLeft: 20,
                        paddingRight: 20,
                      }}
                      scrollbars="vertical"
                    >
                      <Flex direction="column" gap="4">
                        {/* Group models by provider */}
                        {Object.entries(
                          textModels.reduce<Record<string, CachedModel[]>>(
                            (groups, model) => {
                              const key = model.provider_id;
                              if (!groups[key]) groups[key] = [];
                              groups[key].push(model);
                              return groups;
                            },
                            {},
                          ),
                        ).map(([providerId, models]) => (
                          <Flex key={providerId} direction="column" gap="2">
                            <Text
                              size="1"
                              weight="medium"
                              color="gray"
                              style={{
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                              }}
                            >
                              {providerMap[providerId] ?? providerId}
                            </Text>
                            <Grid columns={{ initial: "2", sm: "3" }} gap="2">
                              {models.map((model) => {
                                const isSelected =
                                  multiModelSelectedIds.includes(model.id);
                                const isPreferred =
                                  multiModelPreferredId === model.id ||
                                  (!multiModelPreferredId &&
                                    multiModelSelectedIds[0] === model.id);
                                return (
                                  <Flex
                                    key={model.id}
                                    direction="column"
                                    className={`relative rounded-lg px-3 py-2.5 cursor-pointer transition-all ${
                                      isSelected
                                        ? "bg-(--accent-a2) border-2 border-(--accent-7) shadow-sm"
                                        : "bg-(--gray-a2) border-2 border-transparent hover:border-(--gray-a6)"
                                    }`}
                                    onClick={() => {
                                      const newIds = isSelected
                                        ? multiModelSelectedIds.filter(
                                            (id) => id !== model.id,
                                          )
                                        : [...multiModelSelectedIds, model.id];
                                      updateSetting(
                                        "multi_model_selected_ids",
                                        newIds,
                                      );
                                    }}
                                  >
                                    <Text
                                      size="2"
                                      weight="medium"
                                      style={{ lineHeight: 1.3 }}
                                    >
                                      {model.custom_label || model.model_id}
                                    </Text>
                                    <Text size="1" color="gray" mt="0.5">
                                      {model.is_thinking_model
                                        ? "Thinking"
                                        : "Standard"}
                                    </Text>
                                    {/* Star badge */}
                                    {isSelected && (
                                      <Tooltip
                                        content={
                                          isPreferred
                                            ? t(
                                                "settings.postProcessing.textModelMode.preferredModel",
                                                "Preferred",
                                              )
                                            : t(
                                                "settings.postProcessing.textModelMode.setAsPreferred",
                                                "Set as preferred",
                                              )
                                        }
                                      >
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            updateSetting(
                                              "multi_model_preferred_id",
                                              isPreferred &&
                                                multiModelPreferredId
                                                ? null
                                                : model.id,
                                            );
                                          }}
                                          className="absolute top-1.5 right-1.5 cursor-pointer p-0.5 rounded hover:bg-(--gray-a3) transition-colors"
                                        >
                                          {isPreferred ? (
                                            <IconStarFilled
                                              size={14}
                                              className="text-amber-500"
                                            />
                                          ) : (
                                            <IconStar
                                              size={14}
                                              className="text-(--gray-7)"
                                            />
                                          )}
                                        </button>
                                      </Tooltip>
                                    )}
                                  </Flex>
                                );
                              })}
                            </Grid>
                          </Flex>
                        ))}
                      </Flex>
                    </ScrollArea>
                    <Flex
                      justify="between"
                      align="center"
                      px="5"
                      py="3"
                      style={{ borderTop: "1px solid var(--gray-a4)" }}
                    >
                      <Text size="1" color="gray">
                        {multiModelSelectedIds.length > 0
                          ? t(
                              "settings.postProcessing.textModelMode.selectedCount",
                              "{{count}} selected",
                              { count: multiModelSelectedIds.length },
                            )
                          : t(
                              "settings.postProcessing.textModelMode.noneSelected",
                              "No models selected",
                            )}
                      </Text>
                      <Dialog.Close>
                        <button
                          type="button"
                          className="rounded-md bg-(--accent-9) text-white px-4 py-1.5 text-sm font-medium hover:bg-(--accent-10) transition-colors cursor-pointer"
                        >
                          {t("common.done", "Done")}
                        </button>
                      </Dialog.Close>
                    </Flex>
                  </Dialog.Content>
                </Dialog.Root>
              </Flex>
              <Flex
                align="center"
                gap="0"
                className="rounded-full border border-(--gray-6) bg-(--gray-a2) p-0.5"
              >
                {multiStrategyOptions.map((item) => {
                  const selected = multiModelStrategy === item.value;
                  return (
                    <Tooltip key={item.value} content={item.hint}>
                      <button
                        type="button"
                        onClick={() =>
                          updateSetting("multi_model_strategy", item.value)
                        }
                        disabled={isUpdating("multi_model_strategy")}
                        className={`min-w-[50px] rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${selected ? "bg-(--accent-9) text-white" : "text-(--gray-11) hover:bg-(--gray-4)"}`}
                      >
                        {item.label}
                      </button>
                    </Tooltip>
                  );
                })}
              </Flex>
            </Flex>

            {/* Selected model badges */}
            {multiModelSelectedIds.length > 0 && (
              <Flex gap="1" wrap="wrap" align="center">
                {multiModelSelectedIds.map((id) => {
                  const model = textModels.find((m) => m.id === id);
                  if (!model) return null;
                  const isPreferred =
                    multiModelPreferredId === id ||
                    (!multiModelPreferredId && multiModelSelectedIds[0] === id);
                  return (
                    <Tooltip
                      key={id}
                      content={
                        isPreferred
                          ? t(
                              "settings.postProcessing.textModelMode.preferredModel",
                              "Preferred",
                            )
                          : t(
                              "settings.postProcessing.textModelMode.setAsPreferred",
                              "Click to set as preferred",
                            )
                      }
                    >
                      <Badge
                        color={isPreferred ? "amber" : "blue"}
                        variant={isPreferred ? "solid" : "soft"}
                        size="1"
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          updateSetting(
                            "multi_model_preferred_id",
                            isPreferred && multiModelPreferredId ? null : id,
                          )
                        }
                      >
                        {isPreferred ? "★ " : ""}
                        {model.custom_label || model.model_id}
                      </Badge>
                    </Tooltip>
                  );
                })}
              </Flex>
            )}
          </Flex>
        )}
      </Flex>
    </Box>
  );

  // ── Short Text Card (only when smart routing is on) ──
  const shortTextCard = (
    <Box
      className="rounded-lg border border-(--gray-a4) p-3"
      style={{ background: "var(--gray-a2)" }}
    >
      <Flex direction="column" gap="3">
        {/* Header: icon + short text label + slider */}
        <Flex align="center" justify="between" gap="2">
          <Flex align="center" gap="1.5">
            <IconBolt size={15} className="text-(--gray-9)" />
            <Text size="2" weight="medium">
              {t(
                "settings.postProcessing.smartRouting.shortText",
                "Short text",
              )}{" "}
              ≤ {threshold}
            </Text>
          </Flex>
          <Flex align="center" gap="2" style={{ flex: 1, maxWidth: 160 }}>
            <RadixSlider
              value={[threshold]}
              onValueChange={(v) =>
                updateSetting("length_routing_threshold", v[0])
              }
              size="1"
              min={5}
              max={150}
              step={1}
            />
            <Text
              size="1"
              weight="medium"
              color="gray"
              style={{ width: 28, textAlign: "right", flexShrink: 0 }}
            >
              {threshold}
            </Text>
          </Flex>
        </Flex>

        {/* Fast model — left label, right dropdown */}
        <Flex align="center" justify="between">
          <Flex align="center" gap="1">
            <Text size="2" weight="medium">
              {t(
                "settings.postProcessing.smartRouting.fastModel",
                "Fast model",
              )}
            </Text>
            <TooltipIcon
              text={t(
                "settings.postProcessing.smartRouting.fastModel",
                "Fast model",
              )}
              description={t(
                "settings.postProcessing.smartRouting.fastModelHint",
                "A lightweight or fast model for short text. Saves tokens and reduces latency for simple content.",
              )}
            />
          </Flex>
          <Box style={{ minWidth: 160 }}>
            {renderModelSelect(
              shortModelId,
              (v) =>
                updateSetting(
                  "length_routing_short_model_id",
                  v === "__none__" ? null : v,
                ),
              t(
                "settings.postProcessing.lengthRouting.useDefault",
                "Use default",
              ),
            )}
          </Box>
        </Flex>
      </Flex>
    </Box>
  );

  return (
    <SettingsGroup
      title={t("settings.postProcessing.prompts.globalConfigTitle")}
      actions={
        <Switch
          size="1"
          checked={settings?.post_process_enabled ?? false}
          onCheckedChange={handleToggle("post_process_enabled")}
        />
      }
    >
      {enabled && (
        <Flex direction="column" gap="3">
          {/* Row 1: Smart Routing toggle */}
          <Flex align="center" justify="between">
            <Flex align="center" gap="1">
              <Text size="2" weight="medium">
                {t(
                  "settings.postProcessing.smartRouting.title",
                  "Smart Routing",
                )}
              </Text>
              <TooltipIcon
                text={t(
                  "settings.postProcessing.smartRouting.title",
                  "Smart Routing",
                )}
                description={t(
                  "settings.postProcessing.smartRouting.hint",
                  "Automatically reuse previous results for identical text, and use a lightweight model to determine whether short text needs polishing — reducing token cost and latency.",
                )}
              />
            </Flex>
            <Switch
              size="1"
              checked={smartRoutingEnabled}
              onCheckedChange={handleToggle("length_routing_enabled")}
            />
          </Flex>

          {/* Row 2: Cards — short+long when smart routing, or just model card */}
          {smartRoutingEnabled ? (
            <Grid columns={{ initial: "1", sm: "2" }} gap="3">
              {shortTextCard}
              {modelSelectionCard}
            </Grid>
          ) : (
            modelSelectionCard
          )}

          {/* Row 3: Intent model */}
          <Flex align="center" justify="between">
            <Flex align="center" gap="1">
              <Text size="2" weight="medium">
                {t("settings.postProcessing.intentModel.title", "Intent model")}
              </Text>
              <TooltipIcon
                text={t(
                  "settings.postProcessing.intentModel.title",
                  "Intent model",
                )}
                description={t(
                  "settings.postProcessing.intentModel.hint",
                  "Used for Skill routing (detecting which Skill to use) and smart routing action classification (pass_through / lite_polish / full_polish). For lite_polish, it also performs the correction in the same call.",
                )}
              />
            </Flex>
            <Box style={{ minWidth: 180 }}>
              {renderModelSelect(
                intentModelId,
                (v) =>
                  updateSetting(
                    "post_process_intent_model_id",
                    v === "__none__" ? null : v,
                  ),
                t(
                  "settings.postProcessing.intentModel.defaultOption",
                  "Use default",
                ),
              )}
            </Box>
          </Flex>

          {/* Row 4: Auto-injection settings */}
          <AppProfilesContextSettings descriptionMode="inline" grouped={true} />
        </Flex>
      )}
    </SettingsGroup>
  );
};
