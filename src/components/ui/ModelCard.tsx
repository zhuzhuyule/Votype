import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { IconBrain, IconFlame, IconMicrophone, IconRepeat } from "@tabler/icons-react";
import React from "react";

export interface ModelCardStats {
  totalCalls: number;
  avgSpeed: number;
}

export interface ModelCardProps {
  /** Model display name (custom_label or model_id) */
  name: string;
  /** Original model_id (shown in tooltip when name is custom_label) */
  modelId?: string;
  /** Subtitle: provider name, "Standard", "ASR", etc. */
  subtitle?: string;
  /** Whether this is an ASR model */
  isAsr?: boolean;
  /** Whether this is a thinking model */
  isThinking?: boolean;
  /** Call count + speed stats */
  stats?: ModelCardStats | null;
  /** Extra elements rendered in the top-right corner (e.g. selection dot) */
  trailing?: React.ReactNode;
}

function formatSpeed(speed: number): string {
  if (speed >= 1000) return `${(speed / 1000).toFixed(1)}k`;
  if (speed >= 100) return Math.round(speed).toString();
  if (speed >= 10) return speed.toFixed(1);
  return speed.toFixed(2);
}

/**
 * Shared model card content — used in ModelConfigurationPanel and ModelChainSelector.
 * Renders name, subtitle, stats, and type/thinking badges.
 * Does NOT render the outer container (border, background, click handler) —
 * that's the caller's responsibility.
 */
export const ModelCardContent: React.FC<ModelCardProps> = ({
  name,
  modelId,
  subtitle,
  isAsr,
  isThinking,
  stats,
  trailing,
}) => {
  const showTooltip = modelId && modelId !== name;

  return (
    <Flex direction="column">
      {/* Row 1: name + badges */}
      <Flex justify="between" align="start">
        <Flex align="center" gap="1.5" className="min-w-0">
          {showTooltip ? (
            <Tooltip content={modelId} delayDuration={200}>
              <Text size="2" weight="medium" className="truncate" style={{ lineHeight: 1.3 }}>
                {name}
              </Text>
            </Tooltip>
          ) : (
            <Text size="2" weight="medium" className="truncate" style={{ lineHeight: 1.3 }}>
              {name}
            </Text>
          )}
        </Flex>
        <Flex align="center" gap="1" className="shrink-0 ml-1">
          {isThinking && (
            <Tooltip content="Thinking" delayDuration={200}>
              <IconBrain size={12} className="text-purple-500/80" />
            </Tooltip>
          )}
          {isAsr && (
            <Tooltip content="ASR" delayDuration={200}>
              <IconMicrophone size={12} className="text-teal-500/80" />
            </Tooltip>
          )}
          {trailing}
        </Flex>
      </Flex>

      {/* Row 2: subtitle */}
      {subtitle && (
        <Text size="1" color="gray" mt="0.5">
          {subtitle}
        </Text>
      )}

      {/* Row 3: stats */}
      {stats && stats.totalCalls > 0 && (
        <Flex align="center" gap="1" mt="0.5">
          <Flex align="center" gap="0.5">
            <IconRepeat size={10} strokeWidth={2} className="text-(--gray-8)" />
            <Text size="1" color="gray" className="tabular-nums">
              {stats.totalCalls.toLocaleString()}
            </Text>
          </Flex>
          {stats.avgSpeed > 0 && (
            <>
              <Text size="1" color="gray" style={{ opacity: 0.4 }}>·</Text>
              <Flex align="center" gap="0.5">
                <IconFlame size={10} strokeWidth={2} className="text-amber-500/60" />
                <Text size="1" color="gray" className="tabular-nums">
                  {formatSpeed(stats.avgSpeed)} t/s
                </Text>
              </Flex>
            </>
          )}
        </Flex>
      )}
    </Flex>
  );
};
