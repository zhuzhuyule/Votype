import { Flex, Text, Tooltip } from "@radix-ui/themes";
import {
  IconBolt,
  IconBrain,
  IconHistory,
  IconMicrophone,
} from "@tabler/icons-react";
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
  /** Subtitle: provider name, "Text", "ASR", etc. */
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
  const hasStats = !!stats && stats.totalCalls > 0;

  return (
    <Flex direction="column" gap="1">
      <Flex align="center" gap="1.5" className="min-w-0">
        {showTooltip ? (
          <Tooltip content={modelId} delayDuration={200}>
            <Text
              size="2"
              weight="medium"
              className="truncate"
              style={{ lineHeight: 1.3 }}
            >
              {name}
            </Text>
          </Tooltip>
        ) : (
          <Text
            size="2"
            weight="medium"
            className="truncate"
            style={{ lineHeight: 1.3 }}
          >
            {name}
          </Text>
        )}
        {isThinking && (
          <Tooltip content="Thinking" delayDuration={200}>
            <IconBrain size={11} className="shrink-0 text-purple-500/80" />
          </Tooltip>
        )}
        {isAsr && (
          <Tooltip content="ASR" delayDuration={200}>
            <IconMicrophone size={11} className="shrink-0 text-teal-500/80" />
          </Tooltip>
        )}
        {trailing && (
          <Flex align="center" gap="1" className="shrink-0">
            {trailing}
          </Flex>
        )}
      </Flex>

      <Flex align="center" justify="between" gap="3">
        <Flex align="center" gap="1" className="min-w-0 flex-1">
          {subtitle && (
            <Text size="1" color="gray" className="truncate">
              {subtitle}
            </Text>
          )}
        </Flex>

        {hasStats && (
          <Flex align="center" gap="2" className="shrink-0 min-w-fit">
            <Flex align="center" gap="0.5">
              <IconHistory
                size={10}
                strokeWidth={2}
                className="text-(--gray-8)"
              />
              <Text size="1" color="gray" className="tabular-nums">
                {stats.totalCalls.toLocaleString()}
              </Text>
            </Flex>

            {stats.avgSpeed > 0 && (
              <Flex align="center" gap="0.5">
                <IconBolt
                  size={10}
                  strokeWidth={2}
                  className="text-amber-500/70"
                />
                <Text size="1" color="gray" className="tabular-nums">
                  {formatSpeed(stats.avgSpeed)} t/s
                </Text>
              </Flex>
            )}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};
