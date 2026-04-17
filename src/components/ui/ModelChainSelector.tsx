import {
  Badge,
  Dialog,
  Flex,
  Grid,
  ScrollArea,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { IconSelector } from "@tabler/icons-react";
import { ModelCardContent } from "./ModelCard";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getModelTypeLabel } from "../../lib/modelTypeUtils";
import type {
  CachedModel,
  ModelChain,
  ModelChainStrategy,
} from "../../lib/types";
import { useModelSpeedStats } from "../../hooks/useModelSpeedStats";
import { useSettingsStore } from "../../stores/settingsStore";

export interface ModelChainSelectorProps {
  chain: ModelChain | null;
  onChange: (chain: ModelChain | null) => void;
  displayChain?: ModelChain | null;
  modelFilter?: (model: CachedModel) => boolean;
  defaultStrategy?: ModelChainStrategy;
  disabled?: boolean;
  label?: string;
}

const STRATEGIES: ModelChainStrategy[] = ["serial", "staggered", "race"];

export const ModelChainSelector: React.FC<ModelChainSelectorProps> = ({
  chain,
  onChange,
  displayChain = null,
  modelFilter,
  defaultStrategy = "serial",
  disabled = false,
}) => {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const { getAggregatedStats } = useModelSpeedStats();

  const [open, setOpen] = useState(false);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [fallbackId, setFallbackId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<ModelChainStrategy>(defaultStrategy);

  const textModels = useMemo(
    () =>
      (settings?.cached_models ?? []).filter((m) =>
        modelFilter ? modelFilter(m) : true,
      ),
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

  const effectiveDisplayChain = displayChain ?? chain;
  const primaryModel = findModel(effectiveDisplayChain?.primary_id);
  const fallbackModel = findModel(effectiveDisplayChain?.fallback_id);

  // Open dialog: sync local state from chain prop
  const handleOpen = useCallback(() => {
    if (disabled) return;
    setPrimaryId(chain?.primary_id ?? null);
    setFallbackId(chain?.fallback_id ?? null);
    setStrategy(chain?.strategy ?? defaultStrategy);
    setOpen(true);
  }, [chain, defaultStrategy, disabled]);

  // Close dialog: save to parent
  const handleClose = useCallback(() => {
    if (primaryId) {
      onChange({
        primary_id: primaryId,
        fallback_id: fallbackId ?? null,
        strategy: fallbackId ? strategy : "serial",
      });
    } else {
      onChange(null);
    }
    setOpen(false);
  }, [primaryId, fallbackId, strategy, onChange]);

  const handleLeftClick = useCallback(
    (modelId: string) => {
      if (primaryId === modelId) {
        setPrimaryId(null);
      } else {
        setPrimaryId(modelId);
        if (fallbackId === modelId) setFallbackId(null);
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
        if (primaryId === modelId) setPrimaryId(null);
      }
    },
    [fallbackId, primaryId],
  );

  return (
    <>
      {/* Trigger — button style, click to open dialog */}
      <Flex
        direction="column"
        gap="1"
        align="end"
        className={disabled ? "opacity-50" : ""}
      >
        {/* Primary model button */}
        <button
          type="button"
          onClick={handleOpen}
          disabled={disabled}
          className={`inline-flex items-center gap-1 rounded-[var(--radius-2)] px-2 py-1 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] active:bg-[var(--gray-a4)] disabled:cursor-not-allowed ${disabled ? "" : "cursor-pointer"}`}
        >
          <span className="truncate max-w-[180px]">
            {primaryModel
              ? getModelName(primaryModel)
              : t("settings.postProcessing.modelChain.noModel")}
          </span>
          <IconSelector className="w-3 h-3 text-[var(--gray-9)] flex-shrink-0" />
        </button>

        {/* Fallback badge — show strategy mode when set, [备] when not */}
        {fallbackModel ? (
          <button
            type="button"
            onClick={handleOpen}
            disabled={disabled}
            title={`${t("modelSelector.asrFallback.label")}: ${getModelName(fallbackModel)}`}
            className="px-1 py-px rounded-sm bg-[var(--amber-a3)] text-[var(--amber-11)] text-[10px] font-medium cursor-pointer hover:bg-[var(--amber-a4)] transition disabled:cursor-not-allowed"
          >
            {t(
              `settings.postProcessing.modelChain.${effectiveDisplayChain?.strategy ?? "serial"}`,
            )}
          </button>
        ) : primaryModel ? (
          <button
            type="button"
            onClick={handleOpen}
            disabled={disabled}
            className="px-1 py-px rounded-sm border border-dashed border-[var(--gray-a6)] text-[var(--gray-9)] text-[10px] cursor-pointer hover:border-[var(--gray-a8)] hover:text-[var(--gray-11)] transition disabled:cursor-not-allowed"
          >
            {t("modelSelector.asrFallback.label")}
          </button>
        ) : null}
      </Flex>

      {/* Dialog — manually controlled, not via Dialog.Trigger */}
      <Dialog.Root
        open={open}
        onOpenChange={(v) => (v ? handleOpen() : handleClose())}
      >
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
                          <div
                            key={model.id}
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
                            <ModelCardContent
                              name={getModelName(model)}
                              modelId={
                                model.custom_label ? model.model_id : undefined
                              }
                              subtitle={getModelTypeLabel(model.model_type)}
                              isAsr={model.model_type === "asr"}
                              isThinking={model.is_thinking_model}
                              stats={getAggregatedStats(
                                model.model_id,
                                model.provider_id,
                              )}
                              trailing={
                                <>
                                  {isPrimary && (
                                    <Tooltip
                                      content={t(
                                        "settings.postProcessing.modelChain.primary",
                                      )}
                                    >
                                      <span className="text-[var(--accent-9)] text-sm">
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
                                      <span className="text-[var(--amber-9)] text-sm">
                                        ○
                                      </span>
                                    </Tooltip>
                                  )}
                                </>
                              }
                            />
                          </div>
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

            {/* Strategy selector — only when fallback is set */}
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

            {/* Footer */}
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
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-1.5 text-sm rounded-[var(--radius-2)] bg-[var(--accent-9)] text-white hover:bg-[var(--accent-10)] transition-colors"
              >
                {t("common.done")}
              </button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};
