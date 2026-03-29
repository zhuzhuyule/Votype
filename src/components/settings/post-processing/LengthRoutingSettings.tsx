import {
  Badge,
  Box,
  Flex,
  Grid,
  Select,
  Slider as RadixSlider,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel } from "../../../lib/types";
import { SettingsGroup } from "../../ui/SettingsGroup";

type ModelMode = "single" | "multi";

export const TextModelModeSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, selectPromptModel, isUpdating } =
    useSettings();

  const smartRoutingEnabled = settings?.length_routing_enabled ?? false;
  const multiModelEnabled = settings?.multi_model_post_process_enabled ?? false;

  const modelMode: ModelMode = multiModelEnabled ? "multi" : "single";

  const threshold = settings?.length_routing_threshold ?? 100;
  const shortModelId = settings?.length_routing_short_model_id ?? null;
  const longModelId = settings?.length_routing_long_model_id ?? null;
  const defaultModelId = settings?.selected_prompt_model_id ?? null;
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

  // --- Handlers ---

  const handleSmartRoutingToggle = useCallback(
    async (checked: boolean) => {
      await updateSetting("length_routing_enabled", checked);
    },
    [updateSetting],
  );

  const handleModelModeChange = useCallback(
    async (newMode: ModelMode) => {
      if (newMode === modelMode) return;
      if (modelMode === "multi") {
        await updateSetting("multi_model_post_process_enabled", false);
      }
      if (newMode === "multi") {
        await updateSetting("multi_model_post_process_enabled", true);
      }
    },
    [modelMode, updateSetting],
  );

  const handleDefaultModelChange = useCallback(
    async (value: string) => {
      if (value && value !== "__none__") {
        await selectPromptModel(value);
      }
    },
    [selectPromptModel],
  );

  const handleThresholdChange = useCallback(
    async (value: number) => {
      await updateSetting("length_routing_threshold", Math.round(value));
    },
    [updateSetting],
  );

  const handleShortModelChange = useCallback(
    async (value: string) => {
      await updateSetting(
        "length_routing_short_model_id",
        value === "__none__" ? null : value,
      );
    },
    [updateSetting],
  );

  const handleLongModelChange = useCallback(
    async (value: string) => {
      await updateSetting(
        "length_routing_long_model_id",
        value === "__none__" ? null : value,
      );
    },
    [updateSetting],
  );

  const getModelLabel = (model: CachedModel) => {
    const provider = providerMap[model.provider_id] ?? model.provider_id;
    const name = model.custom_label || model.model_id;
    return `${name} (${provider})`;
  };

  const renderModelSelect = (
    value: string | null,
    onChange: (value: string) => void,
    placeholder?: string,
  ) => (
    <Select.Root value={value ?? "__none__"} onValueChange={onChange}>
      <Select.Trigger style={{ width: "100%" }} />
      <Select.Content>
        {placeholder && (
          <Select.Item value="__none__">{placeholder}</Select.Item>
        )}
        {textModels.map((model) => (
          <Select.Item key={model.id} value={model.id}>
            {getModelLabel(model)}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );

  const modelModes: { value: ModelMode; label: string }[] = [
    {
      value: "single",
      label: t("settings.postProcessing.textModelMode.single", "Single"),
    },
    {
      value: "multi",
      label: t("settings.postProcessing.textModelMode.multi", "Multi"),
    },
  ];

  const multiStrategyOptions = [
    {
      value: "manual" as const,
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
      value: "race" as const,
      label: t(
        "settings.postProcessing.textModelMode.multiStrategyRaceShort",
        "Ultra-fast",
      ),
      hint: t(
        "settings.postProcessing.textModelMode.multiStrategyRaceHint",
        "Use the first available result",
      ),
    },
    {
      value: "lazy" as const,
      label: t(
        "settings.postProcessing.textModelMode.multiStrategyLazyShort",
        "Lazy",
      ),
      hint: t(
        "settings.postProcessing.textModelMode.multiStrategyLazyHint",
        "Wait 3s for default model, auto-select by preference on timeout",
      ),
    },
  ];

  const selectedMultiCount = multiModelSelectedIds.length;

  // --- Model mode selector (Level 2) ---
  const modelModeSelector = (
    <Flex align="center" gap="0" className="rounded-lg bg-(--gray-a3) p-0.5">
      {modelModes.map((m) => {
        const isActive = modelMode === m.value;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => handleModelModeChange(m.value)}
            className={`
              rounded-md transition-all duration-200 cursor-pointer whitespace-nowrap
              ${
                isActive
                  ? "bg-white shadow-sm px-5 py-1.5 text-sm font-semibold text-(--gray-12)"
                  : "px-4 py-1.5 text-sm font-medium text-(--gray-9) hover:text-(--gray-11)"
              }
            `}
          >
            {m.label}
          </button>
        );
      })}
    </Flex>
  );

  return (
    <Flex direction="column" gap="4">
      {/* Level 1: Smart Routing Toggle */}
      <SettingsGroup
        title={
          <Flex align="center" justify="between" width="100%">
            <Flex align="center" gap="2">
              <span>
                {t(
                  "settings.postProcessing.smartRouting.title",
                  "Smart Routing",
                )}
              </span>
              <Text size="1" color="gray">
                {t(
                  "settings.postProcessing.smartRouting.description",
                  "Auto-detect intent, reuse history, reduce token cost",
                )}
              </Text>
            </Flex>
            <Switch
              size="1"
              checked={smartRoutingEnabled}
              onCheckedChange={handleSmartRoutingToggle}
            />
          </Flex>
        }
      >
        {smartRoutingEnabled && (
          <Grid columns="3" gap="3">
            <Text size="2" weight="medium" color="gray" as="div">
              {t(
                "settings.postProcessing.lengthRouting.thresholdLabel",
                "Character threshold",
              )}
            </Text>
            <Text size="2" weight="medium" color="gray" as="div">
              {t(
                "settings.postProcessing.lengthRouting.shortModelLabel",
                "Short text",
              )}{" "}
              ≤ {threshold}
            </Text>
            <Text size="2" weight="medium" color="gray" as="div">
              {t(
                "settings.postProcessing.lengthRouting.longModelLabel",
                "Long text",
              )}{" "}
              &gt; {threshold}
            </Text>

            <Flex align="center" gap="2">
              <Box style={{ flex: 1 }}>
                <RadixSlider
                  value={[threshold]}
                  onValueChange={(v) => handleThresholdChange(v[0])}
                  size="1"
                  min={10}
                  max={500}
                  step={10}
                />
              </Box>
              <Text
                size="2"
                weight="medium"
                style={{
                  width: "2rem",
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {Math.round(threshold)}
              </Text>
            </Flex>
            <Box>
              {renderModelSelect(
                shortModelId,
                handleShortModelChange,
                t(
                  "settings.postProcessing.lengthRouting.useDefault",
                  "Use global default",
                ),
              )}
            </Box>
            <Box>
              {renderModelSelect(
                longModelId,
                handleLongModelChange,
                t(
                  "settings.postProcessing.lengthRouting.useDefault",
                  "Use global default",
                ),
              )}
            </Box>
          </Grid>
        )}
      </SettingsGroup>

      {/* Level 2: Model Selection */}
      <SettingsGroup
        title={
          <Flex align="center" gap="3">
            <span>
              {t(
                "settings.postProcessing.textModelMode.title",
                "Model Selection",
              )}
            </span>
            {modelModeSelector}
          </Flex>
        }
      >
        {/* Single model mode */}
        {modelMode === "single" && (
          <Grid columns="3" gap="3">
            <Text size="2" weight="medium" color="gray" as="div">
              {t(
                "settings.postProcessing.textModelMode.defaultModelDescription",
                "Default model",
              )}
            </Text>
            <Box style={{ gridColumn: "2 / 4" }} />
            <Box>
              {renderModelSelect(
                defaultModelId,
                handleDefaultModelChange,
                t(
                  "settings.postProcessing.textModelMode.noModelSelected",
                  "No model selected",
                ),
              )}
            </Box>
          </Grid>
        )}

        {/* Multi model mode */}
        {modelMode === "multi" && (
          <Flex direction="column" gap="3">
            <Grid columns="3" gap="3">
              <Text size="2" weight="medium" color="gray" as="div">
                {t(
                  "settings.postProcessing.textModelMode.multiStrategy",
                  "Multi-model Strategy",
                )}
              </Text>
              <Box style={{ gridColumn: "2 / 4" }} />

              <Flex
                align="center"
                gap="1"
                className="w-fit rounded-full border border-(--gray-6) bg-(--gray-2) p-1"
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
                        className={`
                          min-w-[66px] rounded-full px-3 py-1.5 text-xs font-medium transition-colors
                          ${
                            selected
                              ? "bg-(--accent-9) text-white"
                              : "text-(--gray-11) hover:bg-(--gray-4)"
                          }
                        `}
                      >
                        {item.label}
                      </button>
                    </Tooltip>
                  );
                })}
              </Flex>
            </Grid>
            {selectedMultiCount > 0 && (
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
                              "Preferred model",
                            )
                          : t(
                              "settings.postProcessing.textModelMode.setAsPreferred",
                              "Set as preferred model",
                            )
                      }
                    >
                      <Badge
                        color={isPreferred ? "amber" : "blue"}
                        variant={isPreferred ? "solid" : "soft"}
                        size="1"
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          if (isPreferred && multiModelPreferredId) {
                            updateSetting("multi_model_preferred_id", null);
                          } else {
                            updateSetting("multi_model_preferred_id", id);
                          }
                        }}
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
      </SettingsGroup>
    </Flex>
  );
};
