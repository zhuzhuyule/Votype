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

  // ── Model Selection Card (reused in both layouts) ──
  const modelSelectionCard = (
    <Box
      className="rounded-lg border border-(--gray-a4) p-3"
      style={{ background: "var(--gray-a2)" }}
    >
      <Flex direction="column" gap="3">
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
            {(["single", "multi"] as ModelMode[]).map((m) => {
              const isActive = modelMode === m;
              const label =
                m === "single"
                  ? t("settings.postProcessing.textModelMode.single", "Single")
                  : t("settings.postProcessing.textModelMode.multi", "Multi");
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    if (m === modelMode) return;
                    updateSetting(
                      "multi_model_post_process_enabled",
                      m === "multi",
                    );
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
                    (!multiModelPreferredId && multiModelSelectedIds[0] === id);
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
                          isPreferred && multiModelPreferredId ? null : id,
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

        <AppProfilesContextSettings descriptionMode="inline" grouped={true} />
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
        <Flex align="center" gap="2">
          <IconBolt size={15} className="text-(--gray-9)" />
          <Text size="2" weight="medium">
            {t("settings.postProcessing.smartRouting.shortText", "Short text")}
          </Text>
          <Text size="1" color="gray">
            ≤ {threshold}
          </Text>
        </Flex>

        {/* Threshold */}
        <Flex align="center" gap="2">
          <Text size="1" color="gray" style={{ whiteSpace: "nowrap" }}>
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
            {t("settings.postProcessing.lengthRouting.chars", "chars")}
          </Text>
        </Flex>

        {/* Short text model */}
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            {t(
              "settings.postProcessing.lengthRouting.shortModelLabel",
              "Model",
            )}
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
          {/* Top row: intent model (left) + smart routing toggle (right) */}
          <Flex
            align="center"
            justify="between"
            className="rounded-lg px-3 py-2"
            style={{ background: "var(--gray-a2)" }}
          >
            <Flex align="center" gap="2.5">
              <IconSparkles size={14} className="text-(--accent-9)" />
              <Text size="1" weight="medium" color="gray">
                {t("settings.postProcessing.intentModel.title", "Intent model")}
              </Text>
              <Box style={{ minWidth: 160 }}>
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
            <Flex align="center" gap="2">
              <IconRoute size={14} className="text-(--accent-9)" />
              <Text size="1" weight="medium" color="gray">
                {t(
                  "settings.postProcessing.smartRouting.title",
                  "Smart Routing",
                )}
              </Text>
              <Switch
                size="1"
                checked={smartRoutingEnabled}
                onCheckedChange={handleToggle("length_routing_enabled")}
              />
            </Flex>
          </Flex>

          {/* Cards: either single (model only) or dual (short + long) */}
          {smartRoutingEnabled ? (
            <Grid columns={{ initial: "1", sm: "2" }} gap="3">
              {shortTextCard}
              {modelSelectionCard}
            </Grid>
          ) : (
            modelSelectionCard
          )}
        </Flex>
      )}
    </SettingsGroup>
  );
};
