import {
  Badge,
  Box,
  Flex,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { CachedModel } from "../../../lib/types";
import { Dropdown } from "../../ui/Dropdown";
import { ModelFallbackBadge } from "../../ui/ModelFallbackBadge";
import { SettingContainer } from "../../ui/SettingContainer";
import { ActionWrapper } from "../../ui";

type ModelMode = "single" | "multi";

export const TextModelModeSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, updateModelChain, isUpdating } =
    useSettings();

  const smartRoutingEnabled = settings?.length_routing_enabled ?? false;
  const multiModelEnabled = settings?.multi_model_post_process_enabled ?? false;
  const modelMode: ModelMode = multiModelEnabled ? "multi" : "single";

  const threshold = settings?.length_routing_threshold ?? 100;
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

  const handleThresholdChange = useCallback(
    async (value: string) => {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 1 && num <= 9999) {
        await updateSetting("length_routing_threshold", num);
      }
    },
    [updateSetting],
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
                  ? "bg-white shadow-sm px-4 py-1 text-xs font-semibold text-(--gray-12)"
                  : "px-3 py-1 text-xs font-medium text-(--gray-9) hover:text-(--gray-11)"
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
    <>
      {/* Smart Routing — uses SettingContainer for consistent look */}
      <SettingContainer
        title={t("settings.postProcessing.smartRouting.title", "Smart Routing")}
        description={t(
          "settings.postProcessing.smartRouting.description",
          "Auto-detect intent, reuse history, reduce token cost",
        )}
        descriptionMode="tooltip"
        grouped={true}
      >
        <ActionWrapper>
          <Flex align="center" gap="3">
            <Switch
              size="1"
              checked={smartRoutingEnabled}
              onCheckedChange={handleSmartRoutingToggle}
            />
            {smartRoutingEnabled && (
              <>
                <Text size="1" color="gray" style={{ whiteSpace: "nowrap" }}>
                  ≤
                </Text>
                <TextField.Root
                  size="1"
                  type="number"
                  value={String(threshold)}
                  onChange={(e) => handleThresholdChange(e.target.value)}
                  style={{ width: 60 }}
                  min={1}
                  max={9999}
                />
                <Flex align="center" gap="2">
                  <Box style={{ minWidth: 160 }}>
                    <Dropdown
                      selectedValue={
                        settings?.length_routing_short_model?.primary_id ?? ""
                      }
                      options={textModels.map((m) => ({
                        value: m.id,
                        label: m.custom_label
                          ? `${m.custom_label} (${m.model_id})`
                          : `${m.model_id} (${m.provider_id})`,
                      }))}
                      onSelect={(value) =>
                        updateModelChain("length_routing_short_model", {
                          primary_id: value,
                          fallback_id:
                            settings?.length_routing_short_model?.fallback_id ??
                            null,
                          strategy:
                            settings?.length_routing_short_model?.strategy ??
                            "serial",
                        })
                      }
                      disabled={!settings?.length_routing_enabled}
                      enableFilter
                    />
                  </Box>
                  <ModelFallbackBadge
                    chain={settings?.length_routing_short_model ?? null}
                    onChange={(c) =>
                      updateModelChain("length_routing_short_model", c)
                    }
                    modelFilter={(m) => m.model_type === "text"}
                    disabled={
                      !settings?.length_routing_enabled ||
                      !settings?.length_routing_short_model?.primary_id
                    }
                  />
                </Flex>
              </>
            )}
          </Flex>
        </ActionWrapper>
      </SettingContainer>

      {/* Model Selection — uses SettingContainer for consistent look */}
      <SettingContainer
        title={t(
          "settings.postProcessing.textModelMode.modelSelection",
          "Model",
        )}
        description={t(
          "settings.postProcessing.textModelMode.title",
          "Post-processing model selection",
        )}
        descriptionMode="tooltip"
        grouped={true}
      >
        <ActionWrapper>
          <Flex direction="column" gap="2">
            <Flex align="center" gap="3">
              {modelModePills}
              {modelMode === "single" && (
                <Flex align="center" gap="2">
                  <Box style={{ minWidth: 180 }}>
                    <Dropdown
                      selectedValue={
                        settings?.selected_prompt_model?.primary_id ?? ""
                      }
                      options={textModels.map((m) => ({
                        value: m.id,
                        label: m.custom_label
                          ? `${m.custom_label} (${m.model_id})`
                          : `${m.model_id} (${m.provider_id})`,
                      }))}
                      onSelect={(value) =>
                        updateModelChain("selected_prompt_model", {
                          primary_id: value,
                          fallback_id:
                            settings?.selected_prompt_model?.fallback_id ??
                            null,
                          strategy:
                            settings?.selected_prompt_model?.strategy ??
                            "staggered",
                        })
                      }
                      disabled={!settings?.post_process_enabled}
                      enableFilter
                    />
                  </Box>
                  <ModelFallbackBadge
                    chain={settings?.selected_prompt_model ?? null}
                    onChange={(c) =>
                      updateModelChain("selected_prompt_model", c)
                    }
                    modelFilter={(m) => m.model_type === "text"}
                    disabled={
                      !settings?.post_process_enabled ||
                      !settings?.selected_prompt_model?.primary_id
                    }
                  />
                </Flex>
              )}
            </Flex>
            {modelMode === "multi" && (
              <Flex direction="column" gap="2">
                <Flex
                  align="center"
                  gap="1"
                  className="w-fit rounded-full border border-(--gray-6) bg-(--gray-2) p-0.5"
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
                            min-w-[56px] rounded-full px-2.5 py-1 text-xs font-medium transition-colors
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
                        (!multiModelPreferredId &&
                          multiModelSelectedIds[0] === id);
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
        </ActionWrapper>
      </SettingContainer>
    </>
  );
};
