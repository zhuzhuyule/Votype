import {
  Badge,
  Box,
  Flex,
  Grid,
  Select,
  Separator,
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

  const modelModePills = (
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
    <SettingsGroup
      title={t(
        "settings.postProcessing.textModelMode.title",
        "Post-processing Mode",
      )}
    >
      <Flex direction="column" gap="3">
        {/* ─── Smart Routing Toggle ─── */}
        <Flex align="center" justify="between">
          <Flex align="center" gap="2">
            <Text size="2" weight="medium">
              {t("settings.postProcessing.smartRouting.title", "Smart Routing")}
            </Text>
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

        {/* Smart Routing config (only when enabled) */}
        {smartRoutingEnabled && (
          <Flex gap="3" align="end" pl="1">
            <Flex direction="column" gap="1" style={{ flex: 1 }}>
              <Text size="1" color="gray">
                {t(
                  "settings.postProcessing.lengthRouting.thresholdLabel",
                  "Threshold",
                )}{" "}
                ({threshold})
              </Text>
              <RadixSlider
                value={[threshold]}
                onValueChange={(v) => handleThresholdChange(v[0])}
                size="1"
                min={10}
                max={500}
                step={10}
              />
            </Flex>
            <Flex direction="column" gap="1" style={{ flex: 1 }}>
              <Text size="1" color="gray">
                {t(
                  "settings.postProcessing.lengthRouting.shortModelLabel",
                  "Short text model",
                )}{" "}
                ≤ {threshold}
              </Text>
              {renderModelSelect(
                shortModelId,
                handleShortModelChange,
                t(
                  "settings.postProcessing.lengthRouting.useDefault",
                  "Use default",
                ),
              )}
            </Flex>
          </Flex>
        )}

        <Separator size="4" />

        {/* ─── Model Selection ─── */}
        <Flex align="center" justify="between">
          <Text size="2" weight="medium">
            {t("settings.postProcessing.textModelMode.modelSelection", "Model")}
          </Text>
          {modelModePills}
        </Flex>

        {/* Single model config */}
        {modelMode === "single" && (
          <Box pl="1" style={{ maxWidth: "50%" }}>
            {renderModelSelect(
              defaultModelId,
              handleDefaultModelChange,
              t(
                "settings.postProcessing.textModelMode.noModelSelected",
                "No model selected",
              ),
            )}
          </Box>
        )}

        {/* Multi model config */}
        {modelMode === "multi" && (
          <Flex direction="column" gap="2" pl="1">
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
      </Flex>
    </SettingsGroup>
  );
};
