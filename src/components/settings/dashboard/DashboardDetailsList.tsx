import { Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import React, { useEffect, useMemo, useRef } from "react";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { DashboardEntryCard } from "./DashboardEntryCard";
import type { HistoryEntry } from "./dashboardTypes";
import { formatEntryTime, toLocalYmd } from "./dashboardUtils";

interface DashboardDetailsListProps {
  entries: HistoryEntry[];
  totalCount: number;
  selectionTitle: string;
  selectedDayTotals: Map<string, number>;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  onCopy: (text: string) => void;
  onToggleSaved: (id: number) => void;
  onDelete: (id: number) => void;
  onRetranscribe: (id: number) => Promise<void>;
  onLoadMore: () => void;
  detailCount: number;
  formatDurationMs: (durationMs: number) => string;
  numberFormat: Intl.NumberFormat;
  t: (key: string, options?: any) => string;
}

export const DashboardDetailsList: React.FC<DashboardDetailsListProps> = ({
  entries,
  totalCount,
  selectionTitle,
  selectedDayTotals,
  getAudioUrl,
  onCopy,
  onToggleSaved,
  onDelete,
  onRetranscribe,
  onLoadMore,
  detailCount,
  formatDurationMs,
  numberFormat,
  t,
}) => {
  const detailsSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!detailsSentinelRef.current) return;

    const sentinel = detailsSentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        onLoadMore();
      },
      { root: null, rootMargin: "200px", threshold: 0.01 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore]);

  const detailGroups = useMemo(() => {
    const map = new Map<string, { label: string; list: HistoryEntry[] }>();
    for (const entry of entries) {
      const date = new Date(entry.timestamp * 1000);
      const id = toLocalYmd(date);
      const label = date.toLocaleDateString();

      const group = map.get(id) ?? { label, list: [] };
      group.list.push(entry);
      map.set(id, group);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [entries]);

  return (
    <SettingsGroup
      title={t("dashboard.details.title")}
      actions={
        <Text size="2" color="gray">
          {t("dashboard.details.count", {
            count: totalCount,
          })}
        </Text>
      }
    >
      <Box className="relative pb-2">
        {detailGroups.length === 0 ? (
          <Text size="2" color="gray">
            {t("dashboard.details.empty")}
          </Text>
        ) : (
          detailGroups.map(([id, { label, list: dayEntries }]) => (
            <Box key={id} className="relative">
              <Box className="bg-mid-gray/5 border border-mid-gray/10 rounded-md px-3 py-2">
                <Flex justify="between" align="center">
                  <Heading size="3" className="text-logo-primary">
                    {label}
                  </Heading>
                  <Text size="2" color="gray">
                    {numberFormat.format(
                      selectedDayTotals.get(id) ?? dayEntries.length,
                    )}
                  </Text>
                </Flex>
              </Box>
              <Box className="pt-3 space-y-3">
                {dayEntries.map((entry) => {
                  const timeInfo = formatEntryTime(entry.timestamp);
                  const appName = entry.app_name?.trim();
                  const metaParts: string[] = [];
                  if (
                    typeof entry.duration_ms === "number" &&
                    entry.duration_ms > 0
                  ) {
                    metaParts.push(formatDurationMs(entry.duration_ms));
                  }
                  if (
                    typeof entry.char_count === "number" &&
                    entry.char_count > 0
                  ) {
                    metaParts.push(
                      t("dashboard.details.meta.chars", {
                        value: numberFormat.format(entry.char_count),
                      }),
                    );
                  }
                  const meta = metaParts.join(" · ");

                  return (
                    <DashboardEntryCard
                      key={entry.id}
                      entry={entry}
                      getAudioUrl={getAudioUrl}
                      metaText={meta}
                      timeText={timeInfo.time}
                      appName={appName ?? null}
                      onCopy={onCopy}
                      onToggleSaved={onToggleSaved}
                      onDelete={onDelete}
                      onRetranscribe={onRetranscribe}
                    />
                  );
                })}
              </Box>
            </Box>
          ))
        )}
        <div detail-sentinel="" ref={detailsSentinelRef} className="h-1 w-full" />
      </Box>

      {entries.length < detailCount && (
        <Flex justify="center">
          <Button variant="soft" onClick={onLoadMore}>
            {t("dashboard.details.loadMore")}
          </Button>
        </Flex>
      )}
    </SettingsGroup>
  );
};
