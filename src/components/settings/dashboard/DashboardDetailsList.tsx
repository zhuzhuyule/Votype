import { Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  onReprocess: (
    id: number,
    promptId: string,
    inputText?: string,
  ) => Promise<void>;
  onLoadMore: () => void;
  detailCount: number;
  formatDurationMs: (durationMs: number) => string;
  numberFormat: Intl.NumberFormat;
  t: (key: string, options?: any) => string;
}

// Estimated heights for virtual scroll
const ESTIMATED_ENTRY_HEIGHT = 220;
const ESTIMATED_HEADER_HEIGHT = 50;
const BUFFER_ITEMS = 3;

export const DashboardDetailsList: React.FC<DashboardDetailsListProps> = ({
  entries,
  totalCount,
  selectedDayTotals,
  getAudioUrl,
  onCopy,
  onToggleSaved,
  onDelete,
  onRetranscribe,
  onReprocess,
  onLoadMore,
  detailCount,
  formatDurationMs,
  numberFormat,
  t,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });

  // Build flat list of items (headers + entries) for virtual scroll
  const flatItems = useMemo(() => {
    const items: Array<
      | { type: "header"; dayId: string; label: string; count: number }
      | { type: "entry"; entry: HistoryEntry; dayId: string }
    > = [];
    const dayMap = new Map<string, HistoryEntry[]>();

    for (const entry of entries) {
      const date = new Date(entry.timestamp * 1000);
      const dayId = toLocalYmd(date);
      const list = dayMap.get(dayId) ?? [];
      list.push(entry);
      dayMap.set(dayId, list);
    }

    const sortedDays = Array.from(dayMap.entries()).sort(([a], [b]) =>
      b.localeCompare(a),
    );

    for (const [dayId, dayEntries] of sortedDays) {
      const date = new Date(dayEntries[0].timestamp * 1000);
      items.push({
        type: "header",
        dayId,
        label: date.toLocaleDateString(),
        count: selectedDayTotals.get(dayId) ?? dayEntries.length,
      });

      for (const entry of dayEntries) {
        items.push({ type: "entry", entry, dayId });
      }
    }

    return items;
  }, [entries, selectedDayTotals]);

  // Calculate visible range based on scroll position
  const updateVisibleRange = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const viewportTop = window.scrollY;
    const viewportBottom = viewportTop + window.innerHeight;

    // Container position relative to document
    const containerTop = rect.top + window.scrollY;

    // Calculate which items are visible
    let accumulatedHeight = 0;
    let startIndex = 0;
    let endIndex = flatItems.length;

    for (let i = 0; i < flatItems.length; i++) {
      const itemHeight =
        flatItems[i].type === "header"
          ? ESTIMATED_HEADER_HEIGHT
          : ESTIMATED_ENTRY_HEIGHT;
      const itemTop = containerTop + accumulatedHeight;
      const itemBottom = itemTop + itemHeight;

      if (itemBottom < viewportTop - 200) {
        startIndex = i + 1;
      }

      if (itemTop > viewportBottom + 200) {
        endIndex = i;
        break;
      }

      accumulatedHeight += itemHeight;
    }

    // Add buffer
    startIndex = Math.max(0, startIndex - BUFFER_ITEMS);
    endIndex = Math.min(flatItems.length, endIndex + BUFFER_ITEMS);

    setVisibleRange((prev) => {
      if (prev.start === startIndex && prev.end === endIndex) return prev;
      return { start: startIndex, end: endIndex };
    });

    // Trigger load more if near end
    if (endIndex >= flatItems.length - 5 && entries.length < totalCount) {
      onLoadMore();
    }
  }, [flatItems, entries.length, totalCount, onLoadMore]);

  // Listen to scroll events
  useEffect(() => {
    updateVisibleRange();

    const handleScroll = () => {
      requestAnimationFrame(updateVisibleRange);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [updateVisibleRange]);

  // Recalculate on items change
  useLayoutEffect(() => {
    updateVisibleRange();
  }, [flatItems.length, updateVisibleRange]);

  // Calculate padding for virtual scroll
  const { paddingTop, paddingBottom, visibleItems } = useMemo(() => {
    let top = 0;
    let bottom = 0;

    // Calculate top padding (items before visible range)
    for (let i = 0; i < visibleRange.start; i++) {
      top +=
        flatItems[i]?.type === "header"
          ? ESTIMATED_HEADER_HEIGHT
          : ESTIMATED_ENTRY_HEIGHT;
    }

    // Calculate bottom padding (items after visible range)
    for (let i = visibleRange.end; i < flatItems.length; i++) {
      bottom +=
        flatItems[i]?.type === "header"
          ? ESTIMATED_HEADER_HEIGHT
          : ESTIMATED_ENTRY_HEIGHT;
    }

    return {
      paddingTop: top,
      paddingBottom: bottom,
      visibleItems: flatItems.slice(visibleRange.start, visibleRange.end),
    };
  }, [flatItems, visibleRange]);

  return (
    <SettingsGroup
      title={t("dashboard.details.title")}
      actions={
        <Text size="2" color="gray">
          {t("dashboard.details.count", { count: totalCount })}
        </Text>
      }
    >
      <Box ref={containerRef} className="relative">
        {flatItems.length === 0 ? (
          <Text size="2" color="gray">
            {t("dashboard.details.empty")}
          </Text>
        ) : (
          <Box
            style={{
              paddingTop: `${paddingTop}px`,
              paddingBottom: `${paddingBottom}px`,
            }}
          >
            {visibleItems.map((item, idx) => {
              if (item.type === "header") {
                return (
                  <Box
                    key={`header-${item.dayId}`}
                    className="bg-mid-gray/5 border border-mid-gray/10 rounded-md px-3 py-2 mb-3"
                  >
                    <Flex justify="between" align="center">
                      <Heading size="3" className="text-logo-primary">
                        {item.label}
                      </Heading>
                      <Text size="2" color="gray">
                        {numberFormat.format(item.count)}
                      </Text>
                    </Flex>
                  </Box>
                );
              }

              // Entry item
              const { entry } = item;
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
                <Box key={`entry-${entry.id}`} className="mb-3">
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
                    onReprocess={onReprocess}
                  />
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {entries.length < detailCount && (
        <Flex justify="center" className="mt-4">
          <Button variant="soft" onClick={onLoadMore}>
            {t("dashboard.details.loadMore")}
          </Button>
        </Flex>
      )}
    </SettingsGroup>
  );
};
