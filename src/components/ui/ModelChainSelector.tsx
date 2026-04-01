import {
  Badge,
  Dialog,
  Flex,
  Grid,
  ScrollArea,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { IconChevronDown } from "@tabler/icons-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CachedModel,
  ModelChain,
  ModelChainStrategy,
} from "../../lib/types";
import { useSettingsStore } from "../../stores/settingsStore";

export interface ModelChainSelectorProps {
  chain: ModelChain | null;
  onChange: (chain: ModelChain | null) => void;
  modelFilter?: (model: CachedModel) => boolean;
  defaultStrategy?: ModelChainStrategy;
  disabled?: boolean;
  label?: string;
}

const STRATEGIES: ModelChainStrategy[] = ["serial", "staggered", "race"];

export const ModelChainSelector: React.FC<ModelChainSelectorProps> = ({
  chain,
  onChange,
  modelFilter,
  defaultStrategy = "serial",
  disabled = false,
  label,
}) => {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);

  const [open, setOpen] = useState(false);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [fallbackId, setFallbackId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<ModelChainStrategy>(defaultStrategy);

  const textModels = useMemo(
    () =>
      (settings?.cached_models ?? [])
        .filter((m) => m.model_type === "text")
        .filter((m) => (modelFilter ? modelFilter(m) : true)),
    [settings?.cached_models, modelFilter],
  );

  const providerMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers?.forEach((p) => {
      map[p.id] = p.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const groupedModels = useMemo(() => {
    return textModels.reduce<Record<string, CachedModel[]>>((groups, model) => {
      const key = model.provider_id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(model);
      return groups;
    }, {});
  }, [textModels]);

  const findModel = useCallback(
    (id: string | null | undefined) => {
      if (!id) return null;
      return textModels.find((m) => m.id === id) ?? null;
    },
    [textModels],
  );

  const getModelName = useCallback(
    (model: CachedModel) => model.custom_label || model.model_id,
    [],
  );

  // Derived display values from the chain prop
  const primaryModel = findModel(chain?.primary_id);
  const fallbackModel = findModel(chain?.fallback_id);

  const strategyLabel = useMemo(() => {
    if (!chain?.strategy) return "";
    return t(`settings.postProcessing.modelChain.${chain.strategy}`);
  }, [chain?.strategy, t]);

  // Sync local state when dialog opens
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setPrimaryId(chain?.primary_id ?? null);
        setFallbackId(chain?.fallback_id ?? null);
        setStrategy(chain?.strategy ?? defaultStrategy);
      } else {
        // Save on close
        if (primaryId) {
          onChange({
            primary_id: primaryId,
            fallback_id: fallbackId ?? null,
            strategy: fallbackId ? strategy : "serial",
          });
        } else {
          onChange(null);
        }
      }
      setOpen(nextOpen);
    },
    [chain, defaultStrategy, primaryId, fallbackId, strategy, onChange],
  );

  const handleLeftClick = useCallback(
    (modelId: string) => {
      if (primaryId === modelId) {
        setPrimaryId(null);
      } else {
        setPrimaryId(modelId);
        // If the new primary is the same as fallback, clear fallback
        if (fallbackId === modelId) {
          setFallbackId(null);
        }
      }
    },
    [primaryId, fallbackId],
  );

  const handleRightClick = useCallback(
    (e: React.MouseEvent, modelId: string) => {
      e.preventDefault();
      if (fallbackId === modelId) {
        setFallbackId(null);
      } else {
        setFallbackId(modelId);
        // If the new fallback is the same as primary, clear primary
        if (primaryId === modelId) {
          setPrimaryId(null);
        }
      }
    },
    [fallbackId, primaryId],
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>
        <button
          type="button"
          disabled={disabled}
          className={`flex items-center justify-between min-h-[32px] w-full min-w-[200px] rounded-[var(--radius-2)] bg-[var(--color-surface)] border border-[var(--gray-a7)] px-3 py-2 text-sm text-[var(--gray-12)] transition hover:border-[var(--gray-a8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)] disabled:opacity-50 disabled:cursor-not-allowed ${disabled ? "" : "cursor-pointer"}`}
        >
          <span className="flex items-center gap-2 truncate">
            {primaryModel ? (
              <>
                <span className="truncate">{getModelName(primaryModel)}</span>
                {fallbackModel && (
                  <span className="text-[11px] text-[var(--amber-9)] flex-shrink-0">
                    {t("modelSelector.asrFallback.label")}（
                    {getModelName(fallbackModel)}）
                  </span>
                )}
              </>
            ) : (
              <span className="text-[var(--gray-9)]">
                {t("settings.postProcessing.modelChain.noModel")}
              </span>
            )}
          </span>
          <IconChevronDown className="w-3.5 h-3.5 text-[var(--gray-9)] flex-shrink-0 ml-2" />
        </button>
      </Dialog.Trigger>

      <Dialog.Content maxWidth="640px" style={{ padding: 0 }}>
        <Flex direction="column" gap="0">
          {/* Header */}
          <Flex justify="between" align="center" className="px-5 pt-5 pb-3">
            <Dialog.Title size="4" weight="bold" mb="0">
              {t("settings.postProcessing.modelChain.selectModel")}
            </Dialog.Title>
          </Flex>

          {/* Hints */}
          <Flex gap="4" className="px-5 pb-3">
            <Text size="1" color="gray">
              <span className="text-[var(--accent-9)]">●</span>{" "}
              {t("settings.postProcessing.modelChain.leftClickHint")}
            </Text>
            <Text size="1" color="gray">
              <span className="text-[var(--amber-9)]">○</span>{" "}
              {t("settings.postProcessing.modelChain.rightClickHint")}
            </Text>
          </Flex>

          {/* Model grid */}
          <ScrollArea
            type="auto"
            style={{ maxHeight: "60vh", paddingLeft: 20, paddingRight: 20 }}
            scrollbars="vertical"
          >
            <Flex direction="column" gap="4" className="pb-4">
              {Object.entries(groupedModels).map(([providerId, models]) => (
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
                      const isPrimary = primaryId === model.id;
                      const isFallback = fallbackId === model.id;

                      return (
                        <Flex
                          key={model.id}
                          direction="column"
                          className={`relative rounded-lg px-3 py-2.5 cursor-pointer transition-all select-none ${
                            isPrimary
                              ? "bg-[var(--accent-a3)] border-2 border-[var(--accent-7)] shadow-sm"
                              : isFallback
                                ? "bg-[var(--amber-a3)] border-2 border-[var(--amber-7)] shadow-sm"
                                : "bg-[var(--gray-a2)] border-2 border-transparent hover:border-[var(--gray-a6)]"
                          }`}
                          onClick={() => handleLeftClick(model.id)}
                          onContextMenu={(e) => handleRightClick(e, model.id)}
                        >
                          <Flex justify="between" align="start">
                            <Text
                              size="2"
                              weight="medium"
                              style={{ lineHeight: 1.3 }}
                            >
                              {getModelName(model)}
                            </Text>
                            {isPrimary && (
                              <Tooltip
                                content={t(
                                  "settings.postProcessing.modelChain.primary",
                                )}
                              >
                                <span className="text-[var(--accent-9)] text-sm ml-1">
                                  ●
                                </span>
                              </Tooltip>
                            )}
                            {isFallback && (
                              <Tooltip
                                content={t(
                                  "settings.postProcessing.modelChain.fallback",
                                )}
                              >
                                <span className="text-[var(--amber-9)] text-sm ml-1">
                                  ○
                                </span>
                              </Tooltip>
                            )}
                          </Flex>
                          <Text size="1" color="gray" mt="0.5">
                            {model.is_thinking_model ? "Thinking" : "Standard"}
                          </Text>
                        </Flex>
                      );
                    })}
                  </Grid>
                </Flex>
              ))}
              {textModels.length === 0 && (
                <Text size="2" color="gray" align="center" className="py-8">
                  {t("settings.postProcessing.modelChain.noModel")}
                </Text>
              )}
            </Flex>
          </ScrollArea>

          {/* Strategy selector - only when fallback is set */}
          {fallbackId && (
            <Flex
              align="center"
              gap="3"
              className="px-5 py-3 border-t border-[var(--gray-a5)]"
            >
              <Text size="2" weight="medium" color="gray">
                {t("settings.postProcessing.modelChain.strategy")}
              </Text>
              <Flex gap="1">
                {STRATEGIES.map((s) => (
                  <Tooltip
                    key={s}
                    content={t(`settings.postProcessing.modelChain.${s}Hint`)}
                  >
                    <button
                      type="button"
                      onClick={() => setStrategy(s)}
                      className={`px-3 py-1 text-xs rounded-full transition-colors ${
                        strategy === s
                          ? "bg-[var(--accent-9)] text-white"
                          : "bg-[var(--gray-a3)] text-[var(--gray-11)] hover:bg-[var(--gray-a4)]"
                      }`}
                    >
                      {t(`settings.postProcessing.modelChain.${s}`)}
                    </button>
                  </Tooltip>
                ))}
              </Flex>
            </Flex>
          )}

          {/* Footer with selection summary */}
          <Flex
            justify="between"
            align="center"
            className="px-5 py-3 border-t border-[var(--gray-a5)]"
          >
            <Flex gap="3" align="center">
              {primaryId && (
                <Badge color="blue" variant="soft" size="1">
                  <span className="mr-1">●</span>
                  {getModelName(findModel(primaryId)!)}
                </Badge>
              )}
              {fallbackId && (
                <Badge color="amber" variant="soft" size="1">
                  <span className="mr-1">○</span>
                  {getModelName(findModel(fallbackId)!)}
                </Badge>
              )}
              {!primaryId && !fallbackId && (
                <Text size="2" color="gray">
                  {t("settings.postProcessing.modelChain.noModel")}
                </Text>
              )}
            </Flex>
            <Dialog.Close>
              <button
                type="button"
                className="px-4 py-1.5 text-sm rounded-[var(--radius-2)] bg-[var(--accent-9)] text-white hover:bg-[var(--accent-10)] transition-colors"
              >
                {t("common.done")}
              </button>
            </Dialog.Close>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};
