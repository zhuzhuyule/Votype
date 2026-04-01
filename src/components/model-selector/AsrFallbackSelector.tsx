import { Flex, Popover, Text, Tooltip } from "@radix-ui/themes";
import { IconShieldPlus, IconX } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelChain, ModelChainStrategy } from "../../lib/types";

interface AsrFallbackSelectorProps {
  chain: ModelChain | null;
  onUpdate: (chain: ModelChain | null) => void;
  /** Available ASR models (should already exclude the primary model) */
  asrModels: Array<{ id: string; name: string; providerLabel: string }>;
}

const STRATEGIES: ModelChainStrategy[] = ["serial", "staggered", "race"];

export const AsrFallbackSelector: React.FC<AsrFallbackSelectorProps> = ({
  chain,
  onUpdate,
  asrModels,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const fallbackId = chain?.fallback_id ?? null;
  const strategy = chain?.strategy ?? "serial";
  const fallbackModel = fallbackId
    ? asrModels.find((m) => m.id === fallbackId)
    : null;

  const handleSelectFallback = (modelId: string) => {
    if (!chain) return;
    onUpdate({
      ...chain,
      fallback_id: modelId,
      strategy: chain.strategy ?? "serial",
    });
    setOpen(false);
  };

  const handleClearFallback = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!chain) return;
    onUpdate({ ...chain, fallback_id: null });
  };

  const handleStrategyChange = (s: ModelChainStrategy) => {
    if (!chain) return;
    onUpdate({ ...chain, strategy: s });
  };

  const strategyLabel = t(`settings.postProcessing.modelChain.${strategy}`);

  // Icon button that opens a popover
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Tooltip
          content={
            fallbackModel
              ? `${t("modelSelector.asrFallback.label")}: ${fallbackModel.name} · ${strategyLabel}`
              : t("modelSelector.asrFallback.add")
          }
        >
          <button
            type="button"
            className={`relative p-1 rounded transition-colors cursor-pointer ${
              fallbackModel
                ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                : "text-[var(--gray-9)] hover:text-[var(--gray-11)] hover:bg-[var(--gray-a3)]"
            }`}
          >
            <IconShieldPlus size={15} stroke={1.5} />
            {fallbackModel && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
            )}
          </button>
        </Tooltip>
      </Popover.Trigger>

      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        style={{ padding: 0, minWidth: 220, maxWidth: 280 }}
      >
        {/* Header */}
        <Flex
          align="center"
          justify="between"
          className="px-3 py-2 border-b border-[var(--gray-a4)]"
        >
          <Text size="2" weight="medium">
            {t("modelSelector.asrFallback.label")}
          </Text>
          {fallbackModel && (
            <button
              onClick={handleClearFallback}
              className="p-0.5 rounded hover:bg-[var(--gray-a3)] transition-colors text-[var(--gray-9)]"
              aria-label={t("modelSelector.asrFallback.remove")}
            >
              <IconX size={14} />
            </button>
          )}
        </Flex>

        {/* Model list */}
        <Flex direction="column" className="py-1">
          {asrModels.map((model) => (
            <Flex
              key={model.id}
              align="center"
              gap="2"
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                model.id === fallbackId
                  ? "bg-amber-50 dark:bg-amber-950/20"
                  : "hover:bg-[var(--gray-a2)]"
              }`}
              onClick={() => handleSelectFallback(model.id)}
            >
              <Text size="1" weight="medium" className="truncate flex-1">
                {model.name}
              </Text>
              <Text
                size="1"
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 font-medium border border-blue-100 dark:border-blue-900 flex-shrink-0"
              >
                {model.providerLabel}
              </Text>
            </Flex>
          ))}
          {asrModels.length === 0 && (
            <Text size="1" color="gray" className="px-3 py-2 text-center">
              {t("settings.postProcessing.modelChain.noModel")}
            </Text>
          )}
        </Flex>

        {/* Strategy pills — only when fallback is set */}
        {fallbackId && (
          <Flex gap="1" className="px-3 py-2 border-t border-[var(--gray-a4)]">
            {STRATEGIES.map((s) => (
              <button
                key={s}
                onClick={() => handleStrategyChange(s)}
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                  strategy === s
                    ? "bg-amber-500 text-white"
                    : "bg-[var(--gray-a3)] text-[var(--gray-11)] hover:bg-[var(--gray-a4)]"
                }`}
              >
                {t(`settings.postProcessing.modelChain.${s}`)}
              </button>
            ))}
          </Flex>
        )}
      </Popover.Content>
    </Popover.Root>
  );
};
