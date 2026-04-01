import { Box, Flex, Popover, Text } from "@radix-ui/themes";
import { IconX } from "@tabler/icons-react";
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

const STRATEGY_LABELS: Record<ModelChainStrategy, string> = {
  serial: "settings.postProcess.modelChain.serial",
  staggered: "settings.postProcess.modelChain.staggered",
  race: "settings.postProcess.modelChain.race",
};

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
    onUpdate({
      ...chain,
      fallback_id: null,
    });
  };

  const handleStrategyChange = (s: ModelChainStrategy) => {
    if (!chain) return;
    onUpdate({
      ...chain,
      strategy: s,
    });
  };

  // Fallback is set — show solid box
  if (fallbackModel) {
    return (
      <Box className="px-3 py-1.5">
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger>
            <Flex
              align="center"
              gap="2"
              className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-2 py-1 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-colors"
            >
              <Text size="1" className="text-amber-700 dark:text-amber-400">
                {t("modelSelector.asrFallback.label")}:
              </Text>
              <Text
                size="1"
                className="text-amber-800 dark:text-amber-300 font-medium truncate"
                style={{ maxWidth: 140 }}
              >
                {fallbackModel.name}
              </Text>
              <Text
                size="1"
                className="text-[10px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 font-medium"
              >
                {t(STRATEGY_LABELS[strategy])}
              </Text>
              <button
                onClick={handleClearFallback}
                className="ml-auto p-0.5 rounded hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors text-amber-500 dark:text-amber-500"
                aria-label={t("modelSelector.asrFallback.remove")}
              >
                <IconX className="w-3 h-3" />
              </button>
            </Flex>
          </Popover.Trigger>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={4}
            style={{ padding: 0, minWidth: 200 }}
          >
            <Box className="py-1">
              {asrModels.map((model) => (
                <Flex
                  key={model.id}
                  align="center"
                  gap="2"
                  className={`px-3 py-1.5 cursor-pointer transition-colors ${
                    model.id === fallbackId
                      ? "bg-amber-50 dark:bg-amber-950/20"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                  onClick={() => handleSelectFallback(model.id)}
                >
                  <Text size="1" className="font-medium truncate">
                    {model.name}
                  </Text>
                  <Text
                    size="1"
                    className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium border border-blue-100 flex-shrink-0"
                  >
                    {model.providerLabel}
                  </Text>
                </Flex>
              ))}
            </Box>
            <Box className="border-t border-gray-100 dark:border-gray-800 px-3 py-2">
              <Flex gap="1">
                {STRATEGIES.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStrategyChange(s)}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                      strategy === s
                        ? "bg-amber-500 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {t(STRATEGY_LABELS[s])}
                  </button>
                ))}
              </Flex>
            </Box>
          </Popover.Content>
        </Popover.Root>
      </Box>
    );
  }

  // No fallback — show dashed "add" button
  return (
    <Box className="px-3 py-1.5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger>
          <Flex
            align="center"
            justify="center"
            className="rounded-md border-dashed border-2 border-gray-300 dark:border-gray-600 px-2 py-1 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <Text size="1" className="text-xs text-muted-foreground">
              {t("modelSelector.asrFallback.add")}
            </Text>
          </Flex>
        </Popover.Trigger>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={4}
          style={{ padding: 0, minWidth: 200 }}
        >
          <Box className="py-1">
            {asrModels.map((model) => (
              <Flex
                key={model.id}
                align="center"
                gap="2"
                className="px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                onClick={() => handleSelectFallback(model.id)}
              >
                <Text size="1" className="font-medium truncate">
                  {model.name}
                </Text>
                <Text
                  size="1"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium border border-blue-100 flex-shrink-0"
                >
                  {model.providerLabel}
                </Text>
              </Flex>
            ))}
          </Box>
          <Box className="border-t border-gray-100 dark:border-gray-800 px-3 py-2">
            <Flex gap="1">
              {STRATEGIES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    if (!chain) return;
                    onUpdate({ ...chain, strategy: s });
                  }}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                    strategy === s
                      ? "bg-amber-500 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {t(STRATEGY_LABELS[s])}
                </button>
              ))}
            </Flex>
          </Box>
        </Popover.Content>
      </Popover.Root>
    </Box>
  );
};
