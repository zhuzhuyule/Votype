import { Box, Button, Card, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import { IconFolderOpen } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface HistoryTotals {
  entries: number;
  saved_entries: number;
  post_processed_entries: number;
  duration_ms: number;
  char_count: number;
  corrected_char_count: number;
}

interface HistoryDayBucket {
  day: string; // YYYY-MM-DD (local)
  entries: number;
  duration_ms: number;
  char_count: number;
}

interface HistoryDashboardStats {
  today: HistoryTotals;
  recent: HistoryTotals;
  recent_buckets: HistoryDayBucket[];
  all_time: HistoryTotals;
  recent_days: number;
}

const formatDurationMs = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const toLocalYmd = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const MetricRow: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <Flex justify="between" gap="4">
    <Text size="2" color="gray">
      {label}
    </Text>
    <Text size="2" weight="medium">
      {value}
    </Text>
  </Flex>
);

const StatsCard: React.FC<{
  title: string;
  totals: HistoryTotals;
  labels: {
    entries: string;
    duration: string;
    characters: string;
    saved: string;
    postProcessed: string;
  };
  numberFormat: Intl.NumberFormat;
}> = ({ title, totals, labels, numberFormat }) => {
  return (
    <Card>
      <Flex direction="column" gap="3">
        <Text size="2" color="gray">
          {title}
        </Text>
        <Heading size="6">{numberFormat.format(totals.entries)}</Heading>
        <Flex direction="column" gap="2">
          <MetricRow
            label={labels.duration}
            value={formatDurationMs(totals.duration_ms)}
          />
          <MetricRow
            label={labels.characters}
            value={numberFormat.format(totals.char_count)}
          />
          <MetricRow
            label={labels.saved}
            value={numberFormat.format(totals.saved_entries)}
          />
          <MetricRow
            label={labels.postProcessed}
            value={numberFormat.format(totals.post_processed_entries)}
          />
        </Flex>
      </Flex>
    </Card>
  );
};

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<HistoryDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const numberFormat = useMemo(() => new Intl.NumberFormat(), []);

  useEffect(() => {
    let cancelled = false;
    const load = async (setBusy = true) => {
      try {
        if (setBusy) setLoading(true);
        const res = await invoke<HistoryDashboardStats>(
          "get_history_dashboard_stats",
          { days: 30 },
        );
        if (!cancelled) setStats(res);
      } catch (e) {
        console.error("Failed to load dashboard stats:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    let unlisten: (() => void) | null = null;

    load();
    (async () => {
      try {
        unlisten = await listen("history-updated", () => load(false));
      } catch (e) {
        console.error("Failed to listen for history-updated:", e);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const labels = useMemo(
    () => ({
      entries: t("dashboard.metrics.entries"),
      duration: t("dashboard.metrics.duration"),
      characters: t("dashboard.metrics.characters"),
      saved: t("dashboard.metrics.saved"),
      postProcessed: t("dashboard.metrics.postProcessed"),
    }),
    [t],
  );

  const bars = useMemo(() => {
    if (!stats) return [];
    const daysToShow = Math.min(14, stats.recent_days);
    const bucketsByDay = new Map(stats.recent_buckets.map((b) => [b.day, b]));

    const days: { day: string; entries: number }[] = [];
    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = toLocalYmd(d);
      days.push({ day, entries: bucketsByDay.get(day)?.entries ?? 0 });
    }

    const max = Math.max(1, ...days.map((d) => d.entries));
    return days.map((d) => ({
      ...d,
      heightPct: Math.round((d.entries / max) * 100),
    }));
  }, [stats]);

  return (
    <Flex direction="column" className="w-full max-w-5xl mx-auto" gap="4">
      <Flex justify="between" align="center" gap="4">
        <Heading size="7">{t("dashboard.title")}</Heading>
        <Button
          variant="soft"
          onClick={() => invoke("open_recordings_folder")}
          disabled={loading}
        >
          <IconFolderOpen width={18} height={18} />
          {t("dashboard.actions.openRecordings")}
        </Button>
      </Flex>

      <Grid columns={{ initial: "1", sm: "3" }} gap="4">
        <StatsCard
          title={t("dashboard.cards.today")}
          totals={
            stats?.today ?? {
              entries: 0,
              saved_entries: 0,
              post_processed_entries: 0,
              duration_ms: 0,
              char_count: 0,
              corrected_char_count: 0,
            }
          }
          labels={labels}
          numberFormat={numberFormat}
        />
        <StatsCard
          title={t("dashboard.cards.recent", { days: stats?.recent_days ?? 30 })}
          totals={
            stats?.recent ?? {
              entries: 0,
              saved_entries: 0,
              post_processed_entries: 0,
              duration_ms: 0,
              char_count: 0,
              corrected_char_count: 0,
            }
          }
          labels={labels}
          numberFormat={numberFormat}
        />
        <StatsCard
          title={t("dashboard.cards.allTime")}
          totals={
            stats?.all_time ?? {
              entries: 0,
              saved_entries: 0,
              post_processed_entries: 0,
              duration_ms: 0,
              char_count: 0,
              corrected_char_count: 0,
            }
          }
          labels={labels}
          numberFormat={numberFormat}
        />
      </Grid>

      <Card>
        <Flex direction="column" gap="3">
          <Flex justify="between" align="baseline">
            <Text size="2" color="gray">
              {t("dashboard.activity.title")}
            </Text>
            <Text size="2" color="gray">
              {t("dashboard.activity.subtitle")}
            </Text>
          </Flex>

          <Flex gap="2" align="end" className="h-16">
            {bars.map((b) => (
              <Box
                key={b.day}
                className="flex-1 rounded-sm"
                style={{
                  height: `${b.heightPct}%`,
                  backgroundColor: "var(--accent-9)",
                  opacity: b.entries === 0 ? 0.2 : 0.9,
                }}
                title={`${b.day}: ${b.entries}`}
              />
            ))}
          </Flex>

          <Flex justify="between">
            <Text size="1" color="gray">
              {bars[0]?.day ?? ""}
            </Text>
            <Text size="1" color="gray">
              {bars[bars.length - 1]?.day ?? ""}
            </Text>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
};

