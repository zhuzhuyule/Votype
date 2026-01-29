import { Box, Flex, Text } from "@radix-ui/themes";
import {
  IconClock,
  IconFileText,
  IconHash,
  IconSparkles,
} from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SummaryStats as SummaryStatsType } from "./summaryTypes";

interface SummaryStatsProps {
  stats: SummaryStatsType | null;
  loading: boolean;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 1000).toFixed(1)}k`;
  return num.toLocaleString();
}

type StatTheme = "blue" | "green" | "orange" | "purple";

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  theme: StatTheme;
  className?: string;
}> = ({ icon, label, value, theme, className }) => {
  // Gradient backgrounds with depth
  const themeStyles = {
    blue: "bg-linear-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 text-blue-900 dark:text-blue-100",
    green:
      "bg-linear-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/30 text-green-900 dark:text-green-100",
    orange:
      "bg-linear-to-br from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/30 text-orange-900 dark:text-orange-100",
    purple:
      "bg-linear-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/30 text-purple-900 dark:text-purple-100",
  };

  const iconColors = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    orange: "text-orange-600 dark:text-orange-400",
    purple: "text-purple-600 dark:text-purple-400",
  };

  const iconBgColors = {
    blue: "bg-blue-100 dark:bg-blue-900/50",
    green: "bg-green-100 dark:bg-green-900/50",
    orange: "bg-orange-100 dark:bg-orange-900/50",
    purple: "bg-purple-100 dark:bg-purple-900/50",
  };

  return (
    <Box
      className={`rounded-xl p-3 flex flex-col justify-between relative overflow-hidden shadow-sm ${themeStyles[theme]} ${className || ""}`}
    >
      {/* Decorative icon background */}
      <Box
        className={`absolute -right-2 -top-2 w-16 h-16 rounded-full opacity-20 ${iconBgColors[theme]} blur-sm`}
      />

      <Flex justify="between" align="center" mb="1">
        <Text
          size="1"
          weight="medium"
          className="opacity-70 uppercase tracking-wide"
        >
          {label}
        </Text>
        <Box
          className={`p-1.5 rounded-lg ${iconBgColors[theme]} ${iconColors[theme]}`}
        >
          {icon}
        </Box>
      </Flex>
      <Text
        size="6"
        weight="bold"
        className="tracking-tight leading-none bg-clip-text text-transparent bg-linear-to-br from-gray-900 to-gray-700 dark:from-white dark:to-gray-300"
      >
        {value}
      </Text>
    </Box>
  );
};

export const SummaryStatsCards: React.FC<SummaryStatsProps> = ({
  stats,
  loading,
}) => {
  const { t } = useTranslation();

  if (loading && !stats) {
    return (
      <>
        {[1, 2, 3, 4].map((i) => (
          <Box
            key={i}
            className="bg-linear-to-br from-(--gray-1) to-(--gray-2) dark:from-(--gray-2) dark:to-(--gray-3) rounded-2xl p-4 h-32 animate-pulse shadow-sm"
          />
        ))}
      </>
    );
  }

  if (!stats) return null;

  const cardClass = loading ? "opacity-50 pointer-events-none" : "";

  return (
    <>
      <StatCard
        icon={<IconHash size={20} />}
        label={t("summary.stats.entries")}
        value={stats.entry_count.toString()}
        theme="blue"
        className={cardClass}
      />
      <StatCard
        icon={<IconFileText size={20} />}
        label={t("summary.stats.chars")}
        value={formatNumber(stats.total_chars)}
        theme="green"
        className={cardClass}
      />
      <StatCard
        icon={<IconClock size={20} />}
        label={t("summary.stats.duration")}
        value={formatDuration(stats.total_duration_ms)}
        theme="orange"
        className={cardClass}
      />
      <StatCard
        icon={<IconSparkles size={20} />}
        label={t("summary.stats.aiCalls")}
        value={stats.llm_calls.toString()}
        theme="purple"
        className={cardClass}
      />
    </>
  );
};

export const SummaryAppDistribution: React.FC<SummaryStatsProps> = ({
  stats,
  loading,
}) => {
  const { t } = useTranslation();

  const sortedApps = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.by_app)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 4);
  }, [stats]);

  const maxCount = useMemo(() => {
    if (sortedApps.length === 0) return 1;
    return Math.max(...sortedApps.map(([, s]) => s.count));
  }, [sortedApps]);

  if (loading && !stats) {
    return (
      <Box className="bg-linear-to-br from-gray-50 to-blue-50/20 dark:from-gray-900 dark:to-blue-900/20 rounded-2xl p-4 animate-pulse h-40 shadow-sm" />
    );
  }

  if (!stats) return null;

  return (
    <Box
      className={`bg-linear-to-br from-gray-50 to-blue-50/50 dark:from-gray-900 dark:to-blue-900/20 border border-blue-100/50 dark:border-blue-900/30 rounded-xl p-4 h-full shadow-sm ${loading ? "opacity-50" : ""}`}
    >
      <Flex align="center" gap="2" mb="2">
        <Box className="w-1 h-3 bg-(--accent-9) rounded-full" />
        <Text size="2" weight="medium" className="opacity-80">
          {t("summary.stats.appDistribution")}
        </Text>
      </Flex>
      <Flex direction="column" gap="3">
        {sortedApps.map(([appName, appStats], index) => (
          <Flex key={appName} align="center" gap="2">
            {/* Left: App Name */}
            <Text
              size="1"
              weight="medium"
              className="w-24 truncate opacity-90"
              title={appName}
            >
              {appName}
            </Text>
            {/* Middle: Progress Bar */}
            <div
              className="flex-1 bg-(--gray-4) dark:bg-(--gray-5) rounded-full overflow-hidden shrink-0 shadow-inner"
              style={{ height: "10px" }}
            >
              <div
                className="h-full bg-linear-to-r from-(--accent-9) to-(--accent-8) rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(appStats.count / maxCount) * 100}%` }}
              />
            </div>
            {/* Right: Count */}
            <Text
              size="1"
              className="w-10 text-right opacity-70 tabular-nums font-medium"
            >
              {appStats.count}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Box>
  );
};

export const SummaryHourlyChart: React.FC<SummaryStatsProps> = ({
  stats,
  loading,
}) => {
  const { t } = useTranslation();

  const maxHour = useMemo(() => {
    if (!stats) return 1;
    return Math.max(1, ...stats.by_hour);
  }, [stats]);

  if (loading && !stats) {
    return (
      <Box className="bg-linear-to-br from-gray-50 to-orange-50/20 dark:from-gray-900 dark:to-orange-900/20 rounded-2xl p-4 h-full animate-pulse shadow-sm" />
    );
  }

  if (!stats) return null;

  return (
    <Box
      className={`bg-linear-to-br from-gray-50 to-orange-50/50 dark:from-gray-900 dark:to-orange-900/20 border border-orange-100/50 dark:border-orange-900/30 rounded-xl p-4 h-full shadow-sm ${loading ? "opacity-50" : ""}`}
    >
      <Flex align="center" gap="2" mb="2">
        <Box className="w-1 h-3 bg-(--accent-9) rounded-full" />
        <Text size="2" weight="medium" className="opacity-80">
          {t("summary.stats.timeDistribution")}
        </Text>
      </Flex>

      {/* Variable Height Bar Chart */}
      <Flex
        align="end"
        gap="1"
        className="h-20 w-full border-b border-(--gray-5) dark:border-(--gray-6) pb-1"
      >
        {stats.by_hour.map((count, hour) => {
          const heightPercent = maxHour > 0 ? (count / maxHour) * 100 : 0;
          return (
            <div
              key={hour}
              className="relative group flex-1 flex flex-col justify-end items-center h-full"
            >
              {/* Bar */}
              <div
                className="w-full min-w-[3px] rounded-t-md transition-all duration-300"
                style={{
                  height: `${Math.max(4, heightPercent)}%`,
                  background: `linear-gradient(to top, var(--accent-9), var(--accent-8))`,
                  opacity: count > 0 ? 0.8 : 0.15,
                }}
                title={`${hour}:00 • ${count}`}
              />
            </div>
          );
        })}
      </Flex>
      <Flex className="w-full mt-1 -ml-0.5" gap="1" align="center">
        {Array.from({ length: 24 }).map((_, i) => {
          if (i % 2 !== 0) return <div key={i} className="flex-1" />;
          return (
            <div
              key={i}
              className="flex-1 flex justify-center text-[10px] opacity-40 font-medium select-none"
            >
              <span className="inline-block w-[2ch] text-center">{i}</span>
            </div>
          );
        })}
      </Flex>
    </Box>
  );
};
