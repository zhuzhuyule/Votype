import { Flex, Popover, Text } from "@radix-ui/themes";
import { IconX } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelChain, ModelChainStrategy } from "../../lib/types";

interface AsrFallbackSelectorProps {
  chain: ModelChain | null;
  onUpdate: (chain: ModelChain | null) => void;
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
    e.preventDefault();
    e.stopPropagation();
    if (!chain) return;
    onUpdate({ ...chain, fallback_id: null });
  };

  const handleStrategyChange = (s: ModelChainStrategy) => {
    if (!chain) return;
    onUpdate({ ...chain, strategy: s });
  };

  const triggerContent = fallbackModel ? (
    // 已选备用：显示 "备用（模型名）" + 清除按钮
    <Flex align="center" gap="1">
      <Text size="1" className="text-amber-600 dark:text-amber-400">
        {t("modelSelector.asrFallback.label")}（{fallbackModel.name}）
      </Text>
      <button
        onClick={handleClearFallback}
        className="p-0.5 rounded hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors text-amber-500"
        aria-label={t("modelSelector.asrFallback.remove")}
      >
        <IconX size={12} />
      </button>
    </Flex>
  ) : (
    // 未选备用：虚线框 "备用"
    <Text size="1" className="text-[var(--gray-9)]">
      {t("modelSelector.asrFallback.label")}
    </Text>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          type="button"
          className={`rounded-md px-2 py-0.5 text-xs transition-colors cursor-pointer ${
            fallbackModel
              ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-950/30"
              : "border border-dashed border-[var(--gray-a7)] hover:border-[var(--gray-a9)] hover:bg-[var(--gray-a2)]"
          }`}
        >
          {triggerContent}
        </button>
      </Popover.Trigger>

      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        style={{ padding: 0, minWidth: 220, maxWidth: 280 }}
      >
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
