import {
  Badge,
  Box,
  Flex,
  Grid,
  Select,
  Slider as RadixSlider,
  Text,
} from "@radix-ui/themes";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel } from "../../../lib/types";
import { SettingsGroup } from "../../ui/SettingsGroup";

type TextModelMode = "single" | "length" | "multi";

export const TextModelModeSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, selectPromptModel } = useSettings();

  const lengthRoutingEnabled = settings?.length_routing_enabled ?? false;
  const multiModelEnabled = settings?.multi_model_post_process_enabled ?? false;

  const mode: TextModelMode = multiModelEnabled
    ? "multi"
    : lengthRoutingEnabled
      ? "length"
      : "single";

  const threshold = settings?.length_routing_threshold ?? 100;
  const shortModelId = settings?.length_routing_short_model_id ?? null;
  const longModelId = settings?.length_routing_long_model_id ?? null;
  const defaultModelId = settings?.selected_prompt_model_id ?? null;
  const multiModelSelectedIds = useMemo(
    () => settings?.multi_model_selected_ids ?? [],
    [settings?.multi_model_selected_ids],
  );

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

  const handleModeChange = useCallback(
    async (newMode: TextModelMode) => {
      if (newMode === mode) return;
      // Disable both first, then enable the target
      if (mode === "length") {
        await updateSetting("length_routing_enabled", false);
      } else if (mode === "multi") {
        await updateSetting("multi_model_post_process_enabled", false);
      }
      if (newMode === "length") {
        await updateSetting("length_routing_enabled", true);
      } else if (newMode === "multi") {
        await updateSetting("multi_model_post_process_enabled", true);
      }
    },
    [mode, updateSetting],
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

  const modes: { value: TextModelMode; label: string; hint: string }[] = [
    {
      value: "single",
      label: t("settings.postProcessing.textModelMode.single", "Single"),
      hint: t(
        "settings.postProcessing.textModelMode.singleHint",
        "One model for all text",
      ),
    },
    {
      value: "length",
      label: t("settings.postProcessing.textModelMode.length", "By Length"),
      hint: t(
        "settings.postProcessing.textModelMode.lengthHint",
        "Different models for short/long",
      ),
    },
    {
      value: "multi",
      label: t("settings.postProcessing.textModelMode.multi", "Multi"),
      hint: t(
        "settings.postProcessing.textModelMode.multiHint",
        "Parallel comparison",
      ),
    },
  ];

  // Count selected models for multi mode
  const selectedMultiCount = multiModelSelectedIds.length;

  return (
    <SettingsGroup
      title={t(
        "settings.postProcessing.textModelMode.title",
        "Text Model Mode",
      )}
    >
      {/* Mode selector */}
      <Grid columns="3" gap="2" className="mb-3">
        {modes.map((m) => {
          const isSelected = mode === m.value;
          return (
            <Box
              key={m.value}
              onClick={() => handleModeChange(m.value)}
              className={`
                cursor-pointer rounded-lg border p-2 transition-colors text-center
                ${
                  isSelected
                    ? "bg-(--accent-3) border-(--accent-8)"
                    : "bg-(--gray-2) border-transparent hover:bg-(--gray-4)"
                }
              `}
            >
              <Text
                size="2"
                weight={isSelected ? "bold" : "medium"}
                color={isSelected ? "blue" : undefined}
                as="div"
              >
                {m.label}
              </Text>
              <Text
                size="1"
                color="gray"
                as="div"
                style={{ lineHeight: "1.2" }}
              >
                {m.hint}
              </Text>
            </Box>
          );
        })}
      </Grid>

      {/* Single model mode — label + select right-aligned in 1/3 width */}
      {mode === "single" && (
        <Flex align="center" justify="end" gap="2">
          <Text size="2" weight="medium" color="gray">
            {t(
              "settings.postProcessing.textModelMode.defaultModelDescription",
              "Default model",
            )}
          </Text>
          <Box style={{ width: "33.33%" }}>
            {renderModelSelect(
              defaultModelId,
              handleDefaultModelChange,
              t(
                "settings.postProcessing.textModelMode.noModelSelected",
                "No model selected",
              ),
            )}
          </Box>
        </Flex>
      )}

      {/* Length routing mode — 3 columns: threshold | short model | long model */}
      {mode === "length" && (
        <Grid columns="3" gap="3" align="end">
          <Box>
            <Text size="2" weight="medium" color="gray" mb="1" as="div">
              {t(
                "settings.postProcessing.lengthRouting.thresholdLabel",
                "Character threshold",
              )}
            </Text>
            <Flex align="center" gap="2" style={{ height: "var(--space-6)" }}>
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
          </Box>

          <Box>
            <Text size="2" weight="medium" color="gray" mb="1" as="div">
              {t(
                "settings.postProcessing.lengthRouting.shortModelLabel",
                "Short text",
              )}{" "}
              ≤ {threshold}
            </Text>
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
            <Text size="2" weight="medium" color="gray" mb="1" as="div">
              {t(
                "settings.postProcessing.lengthRouting.longModelLabel",
                "Long text",
              )}{" "}
              &gt; {threshold}
            </Text>
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

      {/* Multi model mode */}
      {mode === "multi" && (
        <Box>
          <Text size="2" color="gray" as="div">
            {t(
              "settings.postProcessing.textModelMode.multiDescription",
              "Select models in the list below for parallel comparison",
            )}
          </Text>
          {selectedMultiCount > 0 && (
            <Flex gap="1" mt="2" wrap="wrap">
              {multiModelSelectedIds.map((id) => {
                const model = textModels.find((m) => m.id === id);
                if (!model) return null;
                return (
                  <Badge key={id} color="blue" variant="soft" size="1">
                    {model.custom_label || model.model_id}
                  </Badge>
                );
              })}
            </Flex>
          )}
        </Box>
      )}
    </SettingsGroup>
  );
};
