import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useMemo, useRef } from "react";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { DashboardEntryCard } from "./DashboardEntryCard";
import type { HistoryEntry } from "./dashboardTypes";
import { formatEntryTime, toLocalYmd } from "./dashboardUtils";

interface VirtualDetailsListProps {
  entries: HistoryEntry[];
  totalCount: number;
  selectedDayTotals: Map<string, number>;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  onCopy: (text: string) => void;
  onToggleSaved: (id: number) => void;
  onDelete: (id: number) => void;
  onRetranscribe: (id: number) => Promise<void>;
  formatDurationMs: (durationMs: number) => string;
  numberFormat: Intl.NumberFormat;
  t: (key: string, options?: any) => string;
}

// Row type for virtualized list: either a day header or an entry
type VirtualRow =
  | { type: "header"; dayId: string; label: string; count: number }
  | { type: "entry"; entry: HistoryEntry; dayId: string };

const ESTIMATED_HEADER_HEIGHT = 50;
const ESTIMATED_ENTRY_HEIGHT = 200;

export const VirtualDetailsList: React.FC<VirtualDetailsListProps> = ({
  entries,
  totalCount,
  selectedDayTotals,
  getAudioUrl,
  onCopy,
  onToggleSaved,
  onDelete,
  onRetranscribe,
  formatDurationMs,
  numberFormat,
  t,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  // Flatten entries into virtual rows: [header, entry, entry, header, entry, ...]
  const virtualRows = useMemo(() => {
    const rows: VirtualRow[] = [];
    const dayMap = new Map<string, HistoryEntry[]>();

    for (const entry of entries) {
      const date = new Date(entry.timestamp * 1000);
      const dayId = toLocalYmd(date);
      const list = dayMap.get(dayId) ?? [];
      list.push(entry);
      dayMap.set(dayId, list);
    }

    // Sort by day descending
    const sortedDays = Array.from(dayMap.entries()).sort(([a], [b]) =>
      b.localeCompare(a),
    );

    for (const [dayId, dayEntries] of sortedDays) {
      const date = new Date(dayEntries[0].timestamp * 1000);
      rows.push({
        type: "header",
        dayId,
        label: date.toLocaleDateString(),
        count: selectedDayTotals.get(dayId) ?? dayEntries.length,
      });

      for (const entry of dayEntries) {
        rows.push({ type: "entry", entry, dayId });
      }
    }

    return rows;
  }, [entries, selectedDayTotals]);

  // Estimate row size based on type
  const estimateSize = useCallback(
    (index: number) => {
      const row = virtualRows[index];
      return row?.type === "header"
        ? ESTIMATED_HEADER_HEIGHT
        : ESTIMATED_ENTRY_HEIGHT;
    },
    [virtualRows],
  );

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 3, // Render 3 extra items above/below viewport
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <SettingsGroup
      title={t("dashboard.details.title")}
      actions={
        <Text size="2" color="gray">
          {t("dashboard.details.count", { count: totalCount })}
        </Text>
      }
    >
      {virtualRows.length === 0 ? (
        <Text size="2" color="gray">
          {t("dashboard.details.empty")}
        </Text>
      ) : (
        <Box
          ref={parentRef}
          className="relative overflow-auto"
          style={{ maxHeight: "70vh" }}
        >
          <Box
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const row = virtualRows[virtualRow.index];

              if (row.type === "header") {
                return (
                  <Box
                    key={`header-${row.dayId}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                  >
                    <Box className="bg-mid-gray/5 border border-mid-gray/10 rounded-md px-3 py-2 mb-3">
                      <Flex justify="between" align="center">
                        <Heading size="3" className="text-logo-primary">
                          {row.label}
                        </Heading>
                        <Text size="2" color="gray">
                          {numberFormat.format(row.count)}
                        </Text>
                      </Flex>
                    </Box>
                  </Box>
                );
              }

              // Entry row
              const entry = row.entry;
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
                <Box
                  key={`entry-${entry.id}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: "12px",
                  }}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                >
                  <DashboardEntryCard
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
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </SettingsGroup>
  );
};
