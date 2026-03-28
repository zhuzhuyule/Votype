import { Box, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../ui/Card";
import { formatCompactNumber } from "./dashboardUtils";

interface DashboardSummary {
  entryCount: number;
  durationMs: number;
  charCount: number;
  transcriptionMs: number;
  rtf: number;
  savedCount: number;
  llmCalls: number;
  llmHits: number;
  llmHitRate: number;
  charsPerMinute: number;
  topApps: [string, number][];
  totalTokens: number;
}

interface DashboardTrends {
  entryCount: number;
  durationMs: number;
  charCount: number;
  llmCalls: number;
}

interface DashboardSummaryCardsProps {
  summary: DashboardSummary;
  trends: DashboardTrends | null;
  formatDurationMs: (durationMs: number) => string;
}

// Trend indicator component
const TrendIndicator: React.FC<{ value: number; className?: string }> = ({
  value,
  className = "",
}) => {
  if (value === 0) return null;

  const isPositive = value > 0;
  const color = isPositive ? "text-emerald-500" : "text-red-400";
  const arrow = isPositive ? "↑" : "↓";

  return (
    <Text size="1" className={`${color} font-medium tabular-nums ${className}`}>
      {arrow} {Math.abs(value)}%
    </Text>
  );
};

// Stylized Microphone Icon
const MicrophoneIcon: React.FC<{ color: string }> = ({ color }) => (
  <Box className="absolute -right-2 -bottom-2 pointer-events-none opacity-25">
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      {/* Microphone body */}
      <rect
        x="30"
        y="10"
        width="30"
        height="50"
        rx="15"
        fill={color}
        opacity="0.8"
      />
      {/* Microphone grille lines */}
      <line
        x1="35"
        y1="20"
        x2="55"
        y2="20"
        stroke="white"
        strokeWidth="2"
        opacity="0.4"
      />
      <line
        x1="35"
        y1="28"
        x2="55"
        y2="28"
        stroke="white"
        strokeWidth="2"
        opacity="0.4"
      />
      <line
        x1="35"
        y1="36"
        x2="55"
        y2="36"
        stroke="white"
        strokeWidth="2"
        opacity="0.4"
      />
      {/* Stand arc */}
      <path
        d="M20 55 Q20 75 45 75 Q70 75 70 55"
        stroke={color}
        strokeWidth="4"
        fill="none"
        opacity="0.6"
      />
      {/* Stand base */}
      <line
        x1="45"
        y1="75"
        x2="45"
        y2="85"
        stroke={color}
        strokeWidth="4"
        opacity="0.6"
      />
      <line
        x1="32"
        y1="85"
        x2="58"
        y2="85"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  </Box>
);

// Text/Translation Icon
const TextIcon: React.FC<{ color: string }> = ({ color }) => (
  <Box className="absolute -right-2 -bottom-2 pointer-events-none opacity-25">
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      {/* Document shape */}
      <rect
        x="15"
        y="10"
        width="60"
        height="70"
        rx="6"
        stroke={color}
        strokeWidth="3"
        fill="none"
        opacity="0.5"
      />
      {/* Text lines */}
      <line
        x1="25"
        y1="25"
        x2="65"
        y2="25"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.8"
      />
      <line
        x1="25"
        y1="38"
        x2="55"
        y2="38"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.6"
      />
      <line
        x1="25"
        y1="50"
        x2="60"
        y2="50"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.6"
      />
      <line
        x1="25"
        y1="62"
        x2="45"
        y2="62"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  </Box>
);

// CPU/Chip Icon for LLM
const CpuIcon: React.FC<{ color: string }> = ({ color }) => (
  <Box className="absolute -right-2 -bottom-2 pointer-events-none opacity-25">
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      {/* Main chip body */}
      <rect
        x="25"
        y="25"
        width="40"
        height="40"
        rx="4"
        fill={color}
        opacity="0.4"
      />
      {/* Inner chip core */}
      <rect
        x="33"
        y="33"
        width="24"
        height="24"
        rx="2"
        fill={color}
        opacity="0.6"
      />
      {/* Core pattern */}
      <rect
        x="38"
        y="38"
        width="14"
        height="14"
        rx="1"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        opacity="0.8"
      />

      {/* Top pins */}
      <rect
        x="32"
        y="15"
        width="4"
        height="12"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="43"
        y="15"
        width="4"
        height="12"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="54"
        y="15"
        width="4"
        height="12"
        rx="1"
        fill={color}
        opacity="0.5"
      />

      {/* Bottom pins */}
      <rect
        x="32"
        y="63"
        width="4"
        height="12"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="43"
        y="63"
        width="4"
        height="12"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="54"
        y="63"
        width="4"
        height="12"
        rx="1"
        fill={color}
        opacity="0.5"
      />

      {/* Left pins */}
      <rect
        x="15"
        y="32"
        width="12"
        height="4"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="15"
        y="43"
        width="12"
        height="4"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="15"
        y="54"
        width="12"
        height="4"
        rx="1"
        fill={color}
        opacity="0.5"
      />

      {/* Right pins */}
      <rect
        x="63"
        y="32"
        width="12"
        height="4"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="63"
        y="43"
        width="12"
        height="4"
        rx="1"
        fill={color}
        opacity="0.5"
      />
      <rect
        x="63"
        y="54"
        width="12"
        height="4"
        rx="1"
        fill={color}
        opacity="0.5"
      />
    </svg>
  </Box>
);

// Grid Dots Pattern
const GridDots: React.FC<{ color: string }> = ({ color }) => (
  <Box className="absolute -right-2 -bottom-2 pointer-events-none opacity-25">
    <svg width="80" height="80" viewBox="0 0 80 80">
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <circle
            key={`${row}-${col}`}
            cx={15 + col * 18}
            cy={15 + row * 18}
            r={2 + (row + col) * 0.5}
            fill={color}
            opacity={0.3 + (row + col) * 0.1}
          />
        )),
      )}
    </svg>
  </Box>
);

// Premium card wrapper with symmetric shadows
const PremiumCard: React.FC<{
  children: React.ReactNode;
  gradientFrom: string;
  gradientTo: string;
  pattern: React.ReactNode;
}> = ({ children, gradientFrom, gradientTo, pattern }) => (
  <Card
    className="relative overflow-hidden p-1! py-0.5! transition-all duration-300 hover:translate-y-[-2px] hover:shadow-md cursor-default"
    shadow="sm"
    style={{
      background: `linear-gradient(145deg, ${gradientFrom} 0%, ${gradientTo} 100%)`,
    }}
  >
    {/* Abstract pattern */}
    {pattern}
    {/* Content */}
    <Flex direction="column" gap="3" className="relative z-10 p-5">
      {children}
    </Flex>
  </Card>
);

export const DashboardSummaryCards: React.FC<DashboardSummaryCardsProps> = ({
  summary,
  trends,
  formatDurationMs,
}) => {
  const { t } = useTranslation();

  return (
    <Grid columns={{ initial: "1", sm: "4" }} gap="4">
      {/* Recording Duration Card - Microphone */}
      <PremiumCard
        gradientFrom="var(--accent-2)"
        gradientTo="var(--accent-3)"
        pattern={<MicrophoneIcon color="var(--accent-9)" />}
      >
        <Flex justify="between" align="center">
          <Text
            size="1"
            weight="medium"
            className="uppercase tracking-wider opacity-50"
          >
            {t("dashboard.summary.recording.title")}
          </Text>
          {trends && <TrendIndicator value={trends.durationMs} />}
        </Flex>
        <Heading size="7" weight="bold" className="tracking-tight tabular-nums">
          {formatDurationMs(summary.durationMs)}
        </Heading>
        <Text size="2" className="opacity-60">
          {t("dashboard.summary.recording.count", {
            count: summary.entryCount,
          })}
        </Text>
      </PremiumCard>

      {/* Transcription Card - Text/Translation */}
      <PremiumCard
        gradientFrom="rgba(59, 130, 246, 0.05)"
        gradientTo="rgba(59, 130, 246, 0.12)"
        pattern={<TextIcon color="#3b82f6" />}
      >
        <Flex justify="between" align="center">
          <Text
            size="1"
            weight="medium"
            className="uppercase tracking-wider opacity-50"
          >
            {t("dashboard.summary.transcription.title")}
          </Text>
          {trends && <TrendIndicator value={trends.charCount} />}
        </Flex>
        <Heading size="7" weight="bold" className="tracking-tight tabular-nums">
          {formatCompactNumber(summary.charCount)}
        </Heading>
        <Text size="2" className="opacity-60">
          {t("dashboard.summary.transcription.speed", {
            rate: Math.round(summary.charsPerMinute),
          })}
        </Text>
      </PremiumCard>

      {/* LLM Card - Brain */}
      <PremiumCard
        gradientFrom="rgba(147, 51, 234, 0.05)"
        gradientTo="rgba(147, 51, 234, 0.12)"
        pattern={<CpuIcon color="#9333ea" />}
      >
        <Flex justify="between" align="center">
          <Text
            size="1"
            weight="medium"
            className="uppercase tracking-wider opacity-50"
          >
            {t("dashboard.summary.llm.title")}
          </Text>
          {trends && <TrendIndicator value={trends.llmCalls} />}
        </Flex>
        <Heading size="7" weight="bold" className="tracking-tight tabular-nums">
          {formatCompactNumber(summary.totalTokens)}{" "}
          <Text size="4" weight="medium" className="opacity-60">
            tokens
          </Text>
        </Heading>
        <Text size="2" className="opacity-60">
          {t("dashboard.summary.llm.calls", {
            count: formatCompactNumber(summary.llmCalls),
          })}
        </Text>
      </PremiumCard>

      {/* Top Apps Card - Grid */}
      <PremiumCard
        gradientFrom="rgba(16, 185, 129, 0.05)"
        gradientTo="rgba(16, 185, 129, 0.12)"
        pattern={<GridDots color="#10b981" />}
      >
        <Text
          size="1"
          weight="medium"
          className="uppercase tracking-wider opacity-50"
        >
          {t("dashboard.summary.apps.title")}
        </Text>
        <Flex direction="column" gap="1" className="mt-1">
          {summary.topApps.length === 0 ? (
            <Text size="2" className="opacity-40 italic">
              {t("dashboard.summary.apps.empty")}
            </Text>
          ) : (
            summary.topApps.map(([app, count], index) => (
              <Flex key={app} align="center" gap="2">
                <Box
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      index === 0
                        ? "#10b981"
                        : index === 1
                          ? "#34d399"
                          : "#6ee7b7",
                  }}
                />
                <Text size="2" weight={index === 0 ? "medium" : "regular"}>
                  {app}
                </Text>
                <Text size="1" className="opacity-40 ml-auto tabular-nums">
                  {formatCompactNumber(count)}
                </Text>
              </Flex>
            ))
          )}
        </Flex>
      </PremiumCard>
    </Grid>
  );
};
