import {
  Flex,
  IconButton,
  Popover,
  ScrollArea,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconCheck,
  IconChevronRight,
  IconLanguage,
  IconPlayerPlay,
  IconRoute,
  IconSettings,
  IconSparkles,
  IconTextGrammar,
  IconWand,
} from "@tabler/icons-react";
import { emit } from "@tauri-apps/api/event";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { getModelDisplayName } from "../../lib/modelDisplay";

type ModelMode = "single" | "multi";

export const PostProcessBar: React.FC = () => {
  const { t } = useTranslation();
  const { settings, getSetting, updateSetting, isUpdating, selectPromptModel } =
    useSettings();
  const [open, setOpen] = useState(false);
  const [tooltipLocked, setTooltipLocked] = useState(false);
  const [showModelList, setShowModelList] = useState(false);

  const realtimeEnabled = getSetting("realtime_transcription_enabled") || false;
  const realtimeUpdating = isUpdating("realtime_transcription_enabled");

  const punctEnabled = getSetting("punctuation_enabled") || false;
  const punctUpdating = isUpdating("punctuation_enabled");

  const translateEnabled = getSetting("translate_to_english") || false;
  const translateUpdating = isUpdating("translate_to_english");

  const llmEnabled = getSetting("post_process_enabled") || false;
  const llmUpdating = isUpdating("post_process_enabled");

  const onlineAsrEnabled = getSetting("online_asr_enabled") || false;
  const secondaryOutputEnabled =
    getSetting("post_process_use_secondary_output") || false;

  const hasActiveProcess =
    realtimeEnabled || punctEnabled || translateEnabled || llmEnabled;

  const textModels = useMemo(
    () =>
      (settings?.cached_models || []).filter(
        (model) => model.model_type === "text",
      ),
    [settings?.cached_models],
  );

  // Smart routing (Level 1)
  const smartRoutingEnabled = settings?.length_routing_enabled ?? false;

  // Model mode (Level 2)
  const multiModelEnabled = settings?.multi_model_post_process_enabled ?? false;
  const modelMode: ModelMode = multiModelEnabled ? "multi" : "single";

  // Single mode
  const selectedModelId = settings?.selected_prompt_model?.primary_id ?? "";
  const selectedModel = textModels.find((m) => m.id === selectedModelId);
  const selectedModelLabel = selectedModel
    ? getModelDisplayName(selectedModel)
    : "";

  // Multi-model
  const multiModelStrategy = settings?.multi_model_strategy ?? "manual";

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

  const navigateToPostProcessing = useCallback(() => {
    setOpen(false);
    emit("navigate-to-settings", "prompts");
  }, []);

  const strategies = ["manual", "race", "lazy"] as const;
  const strategyLabel = (s: string) => {
    switch (s) {
      case "manual":
        return t(
          "settings.postProcessing.textModelMode.multiStrategyManual",
          "Manual",
        );
      case "race":
        return t(
          "settings.postProcessing.textModelMode.multiStrategyRaceShort",
          "Ultra-fast",
        );
      case "lazy":
        return t(
          "settings.postProcessing.textModelMode.multiStrategyLazyShort",
          "Lazy",
        );
      default:
        return s;
    }
  };

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

  const renderModelSection = () => {
    if (!llmEnabled || textModels.length === 0) return null;

    return (
      <Flex direction="column" gap="2">
        {/* Smart Routing toggle */}
        <Flex justify="between" align="center" gap="4">
          <Flex align="center" gap="2">
            <IconRoute size={14} />
            <Text size="2">
              {t("settings.postProcessing.smartRouting.title", "Smart Routing")}
            </Text>
          </Flex>
          <Switch
            size="1"
            checked={smartRoutingEnabled}
            onCheckedChange={(checked) =>
              updateSetting("length_routing_enabled", checked)
            }
          />
        </Flex>

        {/* Model mode selector + settings gear */}
        <Flex align="center" justify="between">
          <Flex
            align="center"
            gap="0"
            className="rounded-full bg-(--gray-a3) p-0.5"
          >
            {modelModes.map((m) => {
              const isActive = modelMode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => handleModelModeChange(m.value)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? "bg-(--color-background) shadow-sm text-(--gray-12)"
                      : "text-(--gray-9) hover:text-(--gray-11)"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </Flex>
          <Tooltip content={t("footer.postProcess.openSettings", "Settings")}>
            <button
              onClick={navigateToPostProcessing}
              className="p-1 rounded-full hover:bg-(--gray-a3) transition-colors cursor-pointer"
            >
              <IconSettings size={12} className="text-(--gray-9)" />
            </button>
          </Tooltip>
        </Flex>

        {/* Single: model picker */}
        {modelMode === "single" && (
          <button
            onClick={() => setShowModelList(!showModelList)}
            className="flex items-center justify-between w-full rounded-md px-2 py-1 cursor-pointer transition-colors bg-(--gray-a3) hover:bg-(--gray-a4)"
          >
            <Text size="1" color="gray" truncate>
              {selectedModelLabel || t("footer.postProcess.selectModel")}
            </Text>
            <IconChevronRight
              size={12}
              className="text-(--gray-9) flex-shrink-0"
            />
          </button>
        )}

        {/* Multi: strategy pills — equal width, centered */}
        {modelMode === "multi" && (
          <Flex
            align="center"
            gap="0"
            className="rounded-full bg-(--gray-a3) p-0.5 w-fit"
          >
            {strategies.map((s) => {
              const isActive = multiModelStrategy === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateSetting("multi_model_strategy", s)}
                  disabled={isUpdating("multi_model_strategy")}
                  className={`flex-1 text-center rounded-full py-0.5 text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? "bg-(--color-background) shadow-sm text-(--gray-12)"
                      : "text-(--gray-9) hover:text-(--gray-11)"
                  }`}
                  style={{ minWidth: 56, paddingLeft: 10, paddingRight: 10 }}
                >
                  {strategyLabel(s)}
                </button>
              );
            })}
          </Flex>
        )}
      </Flex>
    );
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setTooltipLocked(true);
        } else {
          setShowModelList(false);
          setTimeout(() => setTooltipLocked(false), 300);
        }
      }}
    >
      <Tooltip
        content={t("footer.postProcess.title")}
        open={tooltipLocked ? false : undefined}
      >
        <Popover.Trigger>
          <IconButton
            variant="ghost"
            color={hasActiveProcess ? undefined : "gray"}
            size="1"
          >
            <IconSparkles
              size={16}
              style={{ opacity: hasActiveProcess ? 1 : 0.5 }}
            />
          </IconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content
        size="1"
        style={{ minWidth: 240, padding: 12, overflow: "visible" }}
      >
        <div style={{ position: "relative" }}>
          <Flex direction="column" gap="3">
            <Text size="1" weight="bold" color="gray">
              {t("footer.postProcess.title")}
            </Text>

            {(!onlineAsrEnabled || secondaryOutputEnabled) && (
              <Flex justify="between" align="center" gap="4">
                <Flex align="center" gap="2">
                  <IconPlayerPlay size={14} />
                  <Text size="2">{t("footer.postProcess.realtime")}</Text>
                </Flex>
                <Switch
                  size="1"
                  checked={realtimeEnabled}
                  disabled={realtimeUpdating}
                  onCheckedChange={(checked) =>
                    updateSetting("realtime_transcription_enabled", checked)
                  }
                />
              </Flex>
            )}

            <Flex justify="between" align="center" gap="4">
              <Flex align="center" gap="2">
                <IconTextGrammar size={14} />
                <Text size="2">{t("footer.postProcess.punctuation")}</Text>
              </Flex>
              <Switch
                size="1"
                checked={punctEnabled}
                disabled={punctUpdating}
                onCheckedChange={(checked) =>
                  updateSetting("punctuation_enabled", checked)
                }
              />
            </Flex>

            <Flex justify="between" align="center" gap="4">
              <Flex align="center" gap="2">
                <IconLanguage size={14} />
                <Text size="2">{t("footer.postProcess.translate")}</Text>
              </Flex>
              <Switch
                size="1"
                checked={translateEnabled}
                disabled={translateUpdating}
                onCheckedChange={(checked) =>
                  updateSetting("translate_to_english", checked)
                }
              />
            </Flex>

            <Flex justify="between" align="center" gap="4">
              <Flex align="center" gap="2">
                <IconWand size={14} />
                <Text size="2">{t("footer.postProcess.llm")}</Text>
              </Flex>
              <Switch
                size="1"
                checked={llmEnabled}
                disabled={llmUpdating}
                onCheckedChange={(checked) =>
                  updateSetting("post_process_enabled", checked)
                }
              />
            </Flex>

            {renderModelSection()}
          </Flex>

          {/* Model list side panel */}
          {showModelList && (
            <div
              className="absolute left-full bottom-0 ml-3 bg-(--color-panel-solid) border border-(--gray-a6) shadow-lg z-50"
              style={{
                borderRadius: "var(--radius-3)",
                minWidth: 200,
                maxWidth: 280,
              }}
            >
              <ScrollArea
                type="hover"
                scrollbars="vertical"
                style={{ maxHeight: 240 }}
              >
                <Flex direction="column" py="1">
                  {textModels.map((model) => {
                    const isActive = model.id === selectedModelId;
                    const label = getModelDisplayName(model);
                    return (
                      <button
                        key={model.id}
                        onClick={() => {
                          selectPromptModel(model.id);
                          setShowModelList(false);
                        }}
                        className={`flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer transition-colors text-left ${
                          isActive
                            ? "bg-(--accent-a3) text-(--accent-11)"
                            : "hover:bg-(--gray-a3)"
                        }`}
                      >
                        <Text size="1" truncate>
                          {label}
                        </Text>
                        {isActive && (
                          <IconCheck size={14} className="flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </Flex>
              </ScrollArea>
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
};
