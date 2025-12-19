import { Box, Flex, ScrollArea, Spinner, Text } from "@radix-ui/themes";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { DashboardEntryCard } from "./DashboardEntryCard";
import type { HistoryEntry } from "./dashboardTypes";
import { formatEntryTime, toLocalYmd } from "./dashboardUtils";
import { EntryCardSkeleton } from "./EntryCardSkeleton";

interface VirtualDetailsListProps {
  entries: HistoryEntry[];
  totalCount: number;
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
  isLoadingMore?: boolean;
  hasMore?: boolean;
  formatDurationMs: (durationMs: number) => string;
  numberFormat: Intl.NumberFormat;
  t: (key: string, options?: any) => string;
}

// Wrapper component that uses IntersectionObserver to detect visibility
const LazyEntryCard: React.FC<{
  entry: HistoryEntry;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  metaText: string;
  timeText: string;
  appName: string | null;
  onCopy: (text: string) => void;
  onToggleSaved: (id: number) => void;
  onDelete: (id: number) => void;
  onRetranscribe: (id: number) => Promise<void>;
  onReprocess: (
    id: number,
    promptId: string,
    inputText?: string,
  ) => Promise<void>;
}> = ({
  entry,
  getAudioUrl,
  metaText,
  timeText,
  appName,
  onCopy,
  onToggleSaved,
  onDelete,
  onRetranscribe,
  onReprocess,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [capturedHeight, setCapturedHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const element = ref.current;

    // Use viewport-based detection (root: null)
    const observer = new IntersectionObserver(
      (entries) => {
        const nowVisible = entries[0]?.isIntersecting ?? false;
        setIsVisible(nowVisible);
        if (nowVisible && !hasBeenVisible) {
          setHasBeenVisible(true);
        }
      },
      {
        root: null, // Use viewport
        rootMargin: "200px", // Start loading 200px before entering viewport
        threshold: 0.01,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasBeenVisible]);

  // Capture actual height after card is rendered
  useEffect(() => {
    if (hasBeenVisible && ref.current && capturedHeight === null) {
      // Use a small delay to ensure card is fully rendered
      const timer = setTimeout(() => {
        if (ref.current) {
          setCapturedHeight(ref.current.offsetHeight);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hasBeenVisible, capturedHeight]);

  // Show card when visible, skeleton when off-screen (but preserving height)
  const showCard = isVisible || !capturedHeight;

  return (
    <Box
      ref={ref}
      className="mb-3"
      style={{
        minHeight: capturedHeight ?? 160,
        height: !showCard && capturedHeight ? capturedHeight : undefined,
      }}
    >
      {showCard ? (
        <DashboardEntryCard
          entry={entry}
          getAudioUrl={getAudioUrl}
          metaText={metaText}
          timeText={timeText}
          appName={appName}
          onCopy={onCopy}
          onToggleSaved={onToggleSaved}
          onDelete={onDelete}
          onRetranscribe={onRetranscribe}
          onReprocess={onReprocess}
        />
      ) : (
        <EntryCardSkeleton className="h-full" />
      )}
    </Box>
  );
};

export const VirtualDetailsList: React.FC<VirtualDetailsListProps> = ({
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
  isLoadingMore = false,
  hasMore = true,
  formatDurationMs,
  numberFormat,
  t,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Group entries by day
  const dayGroups = useMemo(() => {
    const dayMap = new Map<
      string,
      { label: string; isRecent: boolean; entries: HistoryEntry[] }
    >();
    const todayYmd = toLocalYmd(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayYmd = toLocalYmd(yesterday);

    for (const entry of entries) {
      const date = new Date(entry.timestamp * 1000);
      const dayId = toLocalYmd(date);
      const existing = dayMap.get(dayId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        // Friendly label for today/yesterday
        let label = date.toLocaleDateString();
        let isRecent = false;
        if (dayId === todayYmd) {
          label = `${label} ${t("dashboard.dateLabels.today")}`;
          isRecent = true;
        } else if (dayId === yesterdayYmd) {
          label = `${label} ${t("dashboard.dateLabels.yesterday")}`;
          isRecent = true;
        }
        dayMap.set(dayId, {
          label,
          isRecent,
          entries: [entry],
        });
      }
    }

    return Array.from(dayMap.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [entries, t]);

  // Sentinel for lazy loading - use null root for viewport-based detection
  // Also add scroll event as backup for more reliable triggering
  useEffect(() => {
    if (!sentinelRef.current) return;

    const sentinel = sentinelRef.current;

    // IntersectionObserver with large margin to trigger early
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root: null, // Use viewport as root for more reliable detection
        rootMargin: "400px", // Trigger 400px before sentinel is visible
        threshold: 0.01,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <SettingsGroup
      title={t("dashboard.details.title")}
      contentClassName="-mr-5"
      actions={
        <Text size="2" color="gray">
          {t("dashboard.details.count", { count: totalCount })}
        </Text>
      }
    >
      {dayGroups.length === 0 ? (
        <Text size="2" color="gray">
          {t("dashboard.details.empty")}
        </Text>
      ) : (
        <ScrollArea
          type="auto"
          scrollbars="vertical"
          className="pr-7"
          style={{ height: "calc(100vh - 185px)", minHeight: "800px" }}
        >
          {/* Content with symmetric padding, scrollbar at edge */}
          <Box ref={scrollRef} className="px-2.5">
            {dayGroups.map(
              ([dayId, { label, isRecent, entries: dayEntries }]) => (
                <Box key={dayId} className="mb-4">
                  {/* Day header - solid opaque background with bottom rounded corners */}
                  <Box
                    className="bg-[var(--accent-3)] px-4 py-2 mb-3 sticky top-0 z-10 -mx-2.5"
                    style={{ borderRadius: "var(--radius-4)" }}
                  >
                    <Flex justify="between" align="center">
                      <Text size="2" weight="medium" className="text-text/80">
                        {label}
                      </Text>
                      <Text size="1" color="gray">
                        {t("dashboard.details.recordCount", {
                          count:
                            selectedDayTotals.get(dayId) ?? dayEntries.length,
                        })}
                      </Text>
                    </Flex>
                  </Box>

                  {/* Entries with lazy loading */}
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
                      <LazyEntryCard
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
                        onReprocess={onReprocess}
                      />
                    );
                  })}
                </Box>
              ),
            )}

            {/* Loading indicator and sentinel */}
            {isLoadingMore && (
              <Flex justify="center" py="4">
                <Spinner size="2" />
              </Flex>
            )}
            {hasMore && <div ref={sentinelRef} className="h-1 w-full" />}
          </Box>
        </ScrollArea>
      )}
    </SettingsGroup>
  );
};
