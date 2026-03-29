import {
  Badge,
  Box,
  Flex,
  Grid,
  Select,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconBolt,
  IconBrain,
  IconRoute,
  IconSparkles,
} from "@tabler/icons-react";
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

  const renderModelSelect = useCallback(
    (
      value: string | null,
      onChange: (value: string) => void,
      placeholder?: string,
    ) => (
      <Select.Root value={value ?? "__none__"} onValueChange={onChange}>
        <Select.Trigger
          style={{ width: "100%", maxWidth: 220 }}
          variant="soft"
        />
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
    ),
    [textModels, getModelLabel],
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
  }[] = [
    { value: "manual", label: "Manual" },
    { value: "race", label: "Race" },
    { value: "lazy", label: "Lazy" },
  ];

  return (
    <SettingsGroup
      title={
        <Flex align="center" justify="between" width="100%">
          <span>{t("settings.postProcessing.prompts.globalConfigTitle")}</span>
          <Switch
            size="1"
            checked={settings?.post_process_enabled ?? false}
            onCheckedChange={handleToggle("post_process_enabled")}
          />
        </Flex>
      }
    >
      {enabled && (
        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
          {/* ── Left Column: Smart Routing ── */}
          <Box
            className="rounded-lg border border-(--gray-a4) p-3"
            style={{ background: "var(--gray-a2)" }}
          >
            <Flex direction="column" gap="3">
              {/* Header */}
              <Flex align="center" justify="between">
                <Flex align="center" gap="2">
                  <IconRoute size={15} className="text-(--gray-9)" />
                  <Text size="2" weight="medium">
                    {t(
                      "settings.postProcessing.smartRouting.title",
                      "Smart Routing",
                    )}
                  </Text>
                </Flex>
                <Switch
                  size="1"
                  checked={smartRoutingEnabled}
                  onCheckedChange={handleToggle("length_routing_enabled")}
                />
              </Flex>

              {smartRoutingEnabled && (
                <Flex direction="column" gap="2">
                  {/* Threshold */}
                  <Flex align="center" gap="2">
                    <Text
                      size="1"
                      color="gray"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {t(
                        "settings.postProcessing.lengthRouting.thresholdLabel",
                        "Threshold",
                      )}
                    </Text>
                    <TextField.Root
                      size="1"
                      type="number"
                      value={String(threshold)}
                      onChange={(e) => {
                        const num = parseInt(e.target.value, 10);
                        if (!isNaN(num) && num >= 1) {
                          updateSetting("length_routing_threshold", num);
                        }
                      }}
                      style={{ width: 56 }}
                      min={1}
                      max={9999}
                    />
                    <Text size="1" color="gray">
                      {t(
                        "settings.postProcessing.lengthRouting.chars",
                        "chars",
                      )}
                    </Text>
                  </Flex>

                  {/* Short text model */}
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">
                      <IconBolt
                        size={12}
                        className="inline-block mr-1 align-text-bottom"
                      />
                      {t(
                        "settings.postProcessing.lengthRouting.shortModelLabel",
                        "Short text model",
                      )}{" "}
                      ≤ {threshold}
                    </Text>
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
                  </Flex>

                  {/* Intent model */}
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">
                      <IconSparkles
                        size={12}
                        className="inline-block mr-1 align-text-bottom"
                      />
                      {t(
                        "settings.postProcessing.intentModel.title",
                        "Intent model",
                      )}
                    </Text>
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
                  </Flex>
                </Flex>
              )}
            </Flex>
          </Box>

          {/* ── Right Column: Model Selection ── */}
          <Box
            className="rounded-lg border border-(--gray-a4) p-3"
            style={{ background: "var(--gray-a2)" }}
          >
            <Flex direction="column" gap="3">
              {/* Header with mode pills */}
              <Flex align="center" justify="between">
                <Flex align="center" gap="2">
                  <IconBrain size={15} className="text-(--gray-9)" />
                  <Text size="2" weight="medium">
                    {t(
                      "settings.postProcessing.textModelMode.modelSelection",
                      "Model",
                    )}
                  </Text>
                </Flex>
                <Flex
                  align="center"
                  gap="0"
                  className="rounded-md bg-(--gray-a3) p-0.5"
                >
                  {(["single", "multi"] as ModelMode[]).map((m) => {
                    const isActive = modelMode === m;
                    const label =
                      m === "single"
                        ? t(
                            "settings.postProcessing.textModelMode.single",
                            "Single",
                          )
                        : t(
                            "settings.postProcessing.textModelMode.multi",
                            "Multi",
                          );
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          if (m === modelMode) return;
                          if (m === "multi") {
                            updateSetting(
                              "multi_model_post_process_enabled",
                              true,
                            );
                          } else {
                            updateSetting(
                              "multi_model_post_process_enabled",
                              false,
                            );
                          }
                        }}
                        className={`
                          rounded-md transition-all duration-200 cursor-pointer whitespace-nowrap
                          ${
                            isActive
                              ? "bg-white shadow-sm px-3 py-1 text-xs font-semibold text-(--gray-12)"
                              : "px-2.5 py-1 text-xs font-medium text-(--gray-9) hover:text-(--gray-11)"
                          }
                        `}
                      >
                        {label}
                      </button>
                    );
                  })}
                </Flex>
              </Flex>

              {/* Single model */}
              {modelMode === "single" && (
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">
                    {t(
                      "settings.postProcessing.textModelMode.defaultModelDescription",
                      "Default model",
                    )}
                  </Text>
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
                </Flex>
              )}

              {/* Multi model */}
              {modelMode === "multi" && (
                <Flex direction="column" gap="2">
                  <Flex
                    align="center"
                    gap="1"
                    className="w-fit rounded-full border border-(--gray-6) bg-(--gray-a2) p-0.5"
                  >
                    {multiStrategyOptions.map((item) => {
                      const selected = multiModelStrategy === item.value;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() =>
                            updateSetting("multi_model_strategy", item.value)
                          }
                          disabled={isUpdating("multi_model_strategy")}
                          className={`
                            min-w-[50px] rounded-full px-2.5 py-1 text-xs font-medium transition-colors
                            ${
                              selected
                                ? "bg-(--accent-9) text-white"
                                : "text-(--gray-11) hover:bg-(--gray-4)"
                            }
                          `}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </Flex>
                  {multiModelSelectedIds.length > 0 && (
                    <Flex gap="1" wrap="wrap" align="center">
                      {multiModelSelectedIds.map((id) => {
                        const model = textModels.find((m) => m.id === id);
                        if (!model) return null;
                        const isPreferred =
                          multiModelPreferredId === id ||
                          (!multiModelPreferredId &&
                            multiModelSelectedIds[0] === id);
                        return (
                          <Badge
                            key={id}
                            color={isPreferred ? "amber" : "blue"}
                            variant={isPreferred ? "solid" : "soft"}
                            size="1"
                            style={{ cursor: "pointer" }}
                            onClick={() =>
                              updateSetting(
                                "multi_model_preferred_id",
                                isPreferred && multiModelPreferredId
                                  ? null
                                  : id,
                              )
                            }
                          >
                            {isPreferred ? "★ " : ""}
                            {model.custom_label || model.model_id}
                          </Badge>
                        );
                      })}
                    </Flex>
                  )}
                </Flex>
              )}

              {/* Context settings inline */}
              <AppProfilesContextSettings
                descriptionMode="inline"
                grouped={true}
              />
            </Flex>
          </Box>
        </Grid>
      )}
    </SettingsGroup>
  );
};
