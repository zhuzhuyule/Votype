import { Box, Flex, Grid, Text } from "@radix-ui/themes";
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

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
}> = ({ icon, label, value, subValue }) => (
  <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
    <Flex align="center" gap="2" mb="2">
      <Box className="text-(--gray-9)">{icon}</Box>
      <Text size="1" color="gray">
        {label}
      </Text>
    </Flex>
    <Text size="6" weight="bold" className="block">
      {value}
    </Text>
    {subValue && (
      <Text size="1" color="gray">
        {subValue}
      </Text>
    )}
  </Box>
);

export const SummaryStatsCards: React.FC<SummaryStatsProps> = ({
  stats,
  loading,
}) => {
  const { t } = useTranslation();

  if (loading || !stats) {
    return (
      <Grid columns="4" gap="4">
        {[1, 2, 3, 4].map((i) => (
          <Box
            key={i}
            className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4) animate-pulse h-24"
          />
        ))}
      </Grid>
    );
  }

  return (
    <Grid columns="4" gap="4">
      <StatCard
        icon={<IconHash size={16} />}
        label={t("summary.stats.entries")}
        value={stats.entry_count.toString()}
      />
      <StatCard
        icon={<IconFileText size={16} />}
        label={t("summary.stats.chars")}
        value={formatNumber(stats.total_chars)}
      />
      <StatCard
        icon={<IconClock size={16} />}
        label={t("summary.stats.duration")}
        value={formatDuration(stats.total_duration_ms)}
      />
      <StatCard
        icon={<IconSparkles size={16} />}
        label={t("summary.stats.aiCalls")}
        value={stats.llm_calls.toString()}
      />
    </Grid>
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
      .slice(0, 5);
  }, [stats]);

  const maxCount = useMemo(() => {
    if (sortedApps.length === 0) return 1;
    return Math.max(...sortedApps.map(([, s]) => s.count));
  }, [sortedApps]);

  if (loading || !stats) {
    return (
      <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4) animate-pulse h-40" />
    );
  }

  if (sortedApps.length === 0) {
    return (
      <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
        <Text size="2" color="gray">
          {t("summary.stats.noApps")}
        </Text>
      </Box>
    );
  }

  return (
    <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
      <Text size="2" weight="medium" mb="3" className="block">
        {t("summary.stats.appDistribution")}
      </Text>
      <Flex direction="column" gap="2">
        {sortedApps.map(([appName, appStats]) => (
          <Flex key={appName} align="center" gap="3">
            <Text size="1" className="w-24 truncate">
              {appName}
            </Text>
            <Box className="flex-1 h-2 bg-(--gray-4) rounded-full overflow-hidden">
              <Box
                className="h-full bg-(--accent-9) rounded-full transition-all"
                style={{ width: `${(appStats.count / maxCount) * 100}%` }}
              />
            </Box>
            <Text size="1" color="gray" className="w-12 text-right">
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

  if (loading || !stats) {
    return (
      <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4) animate-pulse h-40" />
    );
  }

  return (
    <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
      <Text size="2" weight="medium" mb="3" className="block">
        {t("summary.stats.timeDistribution")}
      </Text>
      <Flex gap="1" align="end" className="h-20">
        {stats.by_hour.map((count, hour) => (
          <Box
            key={hour}
            className="flex-1 bg-(--accent-9) rounded-t-sm transition-all hover:bg-(--accent-10)"
            style={{
              height: `${(count / maxHour) * 100}%`,
              minHeight: count > 0 ? "4px" : "0",
            }}
            title={`${hour}:00 - ${count} entries`}
          />
        ))}
      </Flex>
      <Flex justify="between" mt="1">
        <Text size="1" color="gray">
          0
        </Text>
        <Text size="1" color="gray">
          12
        </Text>
        <Text size="1" color="gray">
          24
        </Text>
      </Flex>
    </Box>
  );
};
