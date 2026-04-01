import { Flex, Popover, Text } from "@radix-ui/themes";
import { IconX } from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelChain, ModelChainStrategy } from "../../lib/types";
import { useSettingsStore } from "../../stores/settingsStore";

interface ModelFallbackBadgeProps {
  chain: ModelChain | null;
  onChange: (chain: ModelChain | null) => void;
  modelFilter?: (model: { model_type: string }) => boolean;
  disabled?: boolean;
}

const STRATEGIES: ModelChainStrategy[] = ["serial", "staggered", "race"];

/**
 * A compact inline badge for adding/showing a fallback model.
 * Renders as a dashed "备用" button when no fallback is set,
 * or "备用（ModelName）" when set.
 * Clicking opens a popover to pick from available models.
 */
export const ModelFallbackBadge: React.FC<ModelFallbackBadgeProps> = ({
  chain,
  onChange,
  modelFilter,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const [open, setOpen] = useState(false);

  const models = useMemo(() => {
    const all = settings?.cached_models ?? [];
    const filtered = modelFilter ? all.filter(modelFilter) : all;
    // Exclude the primary model
    return filtered.filter((m) => m.id !== chain?.primary_id);
  }, [settings?.cached_models, modelFilter, chain?.primary_id]);

  const providerMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers?.forEach((p) => {
      map[p.id] = p.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const fallbackId = chain?.fallback_id ?? null;
  const strategy = chain?.strategy ?? "serial";
  const fallbackModel = fallbackId
    ? models.find((m) => m.id === fallbackId)
    : null;

  if (!chain?.primary_id || disabled) return null;

  const handleSelect = (modelId: string) => {
    if (!chain) return;
    onChange({
      ...chain,
      fallback_id: modelId,
      strategy: chain.strategy ?? "serial",
    });
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!chain) return;
    onChange({ ...chain, fallback_id: null });
  };

  const handleStrategy = (s: ModelChainStrategy) => {
    if (!chain) return;
    onChange({ ...chain, strategy: s });
  };

  const getModelName = (model: {
    custom_label?: string | null;
    model_id: string;
  }) => model.custom_label || model.model_id;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 text-[11px] transition-colors cursor-pointer inline-flex items-center gap-1 ${
            fallbackModel
              ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/30"
              : "border border-dashed border-[var(--gray-a7)] text-[var(--gray-9)] hover:border-[var(--gray-a9)] hover:bg-[var(--gray-a2)]"
          }`}
        >
          {fallbackModel ? (
            <>
              <span>
                {t("modelSelector.asrFallback.label")}（
                {getModelName(fallbackModel)}）
              </span>
              <span
                onClick={handleClear}
                className="p-0.5 rounded hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
              >
                <IconX size={10} />
              </span>
            </>
          ) : (
            <span>{t("modelSelector.asrFallback.add")}</span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Content
        side="bottom"
        align="start"
        sideOffset={4}
        style={{ padding: 0, minWidth: 220, maxWidth: 300 }}
      >
        <Flex direction="column" className="py-1 max-h-[240px] overflow-y-auto">
          {models.map((model) => (
            <Flex
              key={model.id}
              align="center"
              gap="2"
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                model.id === fallbackId
                  ? "bg-amber-50 dark:bg-amber-950/20"
                  : "hover:bg-[var(--gray-a2)]"
              }`}
              onClick={() => handleSelect(model.id)}
            >
              <Text size="1" weight="medium" className="truncate flex-1">
                {getModelName(model)}
              </Text>
              <Text
                size="1"
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--gray-a3)] text-[var(--gray-11)] font-medium flex-shrink-0"
              >
                {providerMap[model.provider_id] ?? model.provider_id}
              </Text>
            </Flex>
          ))}
          {models.length === 0 && (
            <Text size="1" color="gray" className="px-3 py-2 text-center">
              {t("settings.postProcessing.modelChain.noModel")}
            </Text>
          )}
        </Flex>

        {fallbackId && (
          <Flex gap="1" className="px-3 py-2 border-t border-[var(--gray-a4)]">
            {STRATEGIES.map((s) => (
              <button
                key={s}
                onClick={() => handleStrategy(s)}
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
