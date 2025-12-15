import {
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { IconFolderOpen } from "@tabler/icons-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DashboardEntryCard } from "./DashboardEntryCard";
import type { HistoryEntry, DashboardSelection } from "./dashboardTypes";
import {
  formatDurationMs,
  toLocalYmd,
  countUnicodeChars,
  formatEntryTime,
} from "./dashboardUtils";

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const DETAIL_PAGE_SIZE = 10;
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<DashboardSelection>(() => ({
    type: "day",
    day: toLocalYmd(new Date()),
  }));
  const [detailCount, setDetailCount] = useState(DETAIL_PAGE_SIZE);
  const detailsSentinelRef = useRef<HTMLDivElement | null>(null);
  const audioUrlCacheRef = useRef<Map<string, string | null>>(new Map());

  const numberFormat = useMemo(() => new Intl.NumberFormat(), []);
  const todayYmd = useMemo(() => toLocalYmd(new Date()), []);

  useEffect(() => {
    let cancelled = false;
    const load = async (setBusy = true) => {
      try {
        if (setBusy) setLoading(true);
        const res = await invoke<HistoryEntry[]>("get_history_entries");
        if (!cancelled) setEntries(res);
      } catch (e) {
        console.error("Failed to load history entries for dashboard:", e);
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

  const last30Days = useMemo(() => {
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(toLocalYmd(d));
    }
    return days;
  }, []);

  const bucketsByDay = useMemo(() => {
    const map = new Map<string, { entries: number }>();
    for (const entry of entries) {
      const day = toLocalYmd(new Date(entry.timestamp * 1000));
      const bucket = map.get(day) ?? { entries: 0 };
      bucket.entries += 1;
      map.set(day, bucket);
    }
    return map;
  }, [entries]);

  const selectedDays = useMemo(() => {
    if (selection.type === "day") return new Set([selection.day]);
    if (selection.preset === "30d" || selection.preset === "all") {
      return new Set(last30Days);
    }
    return new Set(last30Days.slice(-7));
  }, [last30Days, selection]);

  const bars = useMemo(() => {
    const days = last30Days.map((day) => ({
      day,
      entries: bucketsByDay.get(day)?.entries ?? 0,
    }));
    const max = Math.max(1, ...days.map((d) => d.entries));
    return days.map((d) => ({
      ...d,
      heightPct: Math.round((d.entries / max) * 100),
      selected: selectedDays.has(d.day),
      isToday: d.day === todayYmd,
    }));
  }, [bucketsByDay, last30Days, selectedDays, todayYmd]);

  const selectionTitle = useMemo(() => {
    if (selection.type === "day") {
      if (selection.day === todayYmd) return t("dashboard.range.today");
      return selection.day;
    }
    if (selection.preset === "7d") return t("dashboard.range.lastNDays", { days: 7 });
    if (selection.preset === "30d")
      return t("dashboard.range.lastNDays", { days: 30 });
    return t("dashboard.range.allTime");
  }, [selection, t, todayYmd]);

  useEffect(() => {
    setDetailCount(DETAIL_PAGE_SIZE);
  }, [selectionTitle]);

  const selectedEntries = useMemo(() => {
    if (selection.type === "preset" && selection.preset === "all") return entries;
    const getDay = (entry: HistoryEntry) =>
      toLocalYmd(new Date(entry.timestamp * 1000));
    if (selection.type === "day") {
      return entries.filter((e) => getDay(e) === selection.day);
    }
    return entries.filter((e) => selectedDays.has(getDay(e)));
  }, [entries, selectedDays, selection]);

  const selectedDayTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of selectedEntries) {
      const day = toLocalYmd(new Date(entry.timestamp * 1000));
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return map;
  }, [selectedEntries]);

  useEffect(() => {
    if (!detailsSentinelRef.current) return;

    const sentinel = detailsSentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setDetailCount((current) => {
          if (current >= selectedEntries.length) return current;
          return Math.min(current + DETAIL_PAGE_SIZE, selectedEntries.length);
        });
      },
      { root: null, rootMargin: "200px", threshold: 0.01 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [selectedEntries.length]);

  const summary = useMemo(() => {
    let entryCount = 0;
    let durationMs = 0;
    let charCount = 0;
    let transcriptionMs = 0;
    let savedCount = 0;
    let llmCalls = 0;
    let llmHits = 0;
    const appCounts = new Map<string, number>();

    for (const entry of selectedEntries) {
      entryCount += 1;
      durationMs += entry.duration_ms ?? 0;
      transcriptionMs += entry.transcription_ms ?? 0;

      if (entry.saved) savedCount += 1;
      if (entry.post_process_prompt?.trim()) llmCalls += 1;
      if (entry.post_processed_text?.trim()) llmHits += 1;

      const appName = entry.app_name?.trim();
      if (appName) {
        appCounts.set(appName, (appCounts.get(appName) ?? 0) + 1);
      }

      if (typeof entry.char_count === "number") {
        charCount += entry.char_count;
      } else if (entry.transcription_text) {
        charCount += countUnicodeChars(entry.transcription_text);
      }
    }

    const rtf = durationMs > 0 ? transcriptionMs / durationMs : 0;
    const llmHitRate = llmCalls > 0 ? llmHits / llmCalls : 0;
    const charsPerMinute =
      durationMs > 0 ? (charCount / durationMs) * 60_000 : 0;
    const topApps = Array.from(appCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return {
      entryCount,
      durationMs,
      charCount,
      transcriptionMs,
      rtf,
      savedCount,
      llmCalls,
      llmHits,
      llmHitRate,
      charsPerMinute,
      topApps,
    };
  }, [selectedEntries]);

  const getAudioUrl = useCallback(async (fileName: string) => {
    try {
      if (audioUrlCacheRef.current.has(fileName)) {
        return audioUrlCacheRef.current.get(fileName) ?? null;
      }
      const filePath = await invoke<string>("get_audio_file_path", {
        fileName,
        file_name: fileName,
      });
      const url = convertFileSrc(`${filePath}`, "asset");
      audioUrlCacheRef.current.set(fileName, url);
      return url;
    } catch (error) {
      console.error("Failed to get audio file path:", error);
      return null;
    }
  }, []);

  const onCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  }, []);

  const onToggleSaved = useCallback(async (id: number) => {
    try {
      await invoke("toggle_history_entry_saved", { id });
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
    }
  }, []);

  const onDelete = useCallback(
    async (id: number) => {
      try {
        await invoke("delete_history_entry", { id });
      } catch (error) {
        console.error("Failed to delete entry:", error);
        alert(t("settings.history.deleteError"));
      }
    },
    [t],
  );

  const detailEntries = useMemo(
    () => selectedEntries.slice(0, detailCount),
    [detailCount, selectedEntries],
  );

  const detailGroups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const entry of detailEntries) {
      const day = toLocalYmd(new Date(entry.timestamp * 1000));
      const group = map.get(day) ?? [];
      group.push(entry);
      map.set(day, group);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [detailEntries]);

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

      <Grid columns={{ initial: "1", sm: "4" }} gap="4">
        <Card className="sm:col-span-3">
          <Flex direction="column" gap="3">
            <Flex justify="between" align="baseline">
              <Text size="2" color="gray">
                {t("dashboard.activity.title")}
              </Text>
              <Text size="2" color="gray">
                {t("dashboard.activity.subtitle")}
              </Text>
            </Flex>

            <Flex gap="2" align="end" className="h-20">
              {bars.map((b) => (
                <Tooltip
                  key={b.day}
                  side="bottom"
                  content={
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="bold">
                        {b.day}
                      </Text>
                      <Text size="2">
                        {t("dashboard.activity.entries", { count: b.entries })}
                      </Text>
                    </Flex>
                  }
                >
                  <button
                    type="button"
                    className="flex-1 rounded-sm transition-all hover:border-2! hover:border-logo-primary!"
                    style={{
                      height: `${Math.max(4, b.heightPct)}%`,
                      backgroundColor: b.selected
                        ? "var(--accent-9)"
                        : "var(--gray-a6)",
                      opacity: b.entries === 0 ? 0.2 : 0.9,
                      cursor: "pointer",
                      transform: b.isToday ? "translateY(-2px)" : undefined,
                      boxShadow: b.isToday ? "0 6px 16px rgba(0,0,0,0.08)" : undefined,
                      border: "2px solid transparent",
                    }}
                    onClick={() => setSelection({ type: "day", day: b.day })}
                  />
                </Tooltip>
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

        <Card>
          <Flex direction="column" gap="2">
            <Button
              variant={
                selection.type === "preset" && selection.preset === "7d"
                  ? "solid"
                  : "soft"
              }
              onClick={() => setSelection({ type: "preset", preset: "7d" })}
              disabled={loading}
            >
              {t("dashboard.range.buttons.last7Days")}
            </Button>
            <Button
              variant={
                selection.type === "preset" && selection.preset === "30d"
                  ? "solid"
                  : "soft"
              }
              onClick={() => setSelection({ type: "preset", preset: "30d" })}
              disabled={loading}
            >
              {t("dashboard.range.buttons.last30Days")}
            </Button>
            <Button
              variant={
                selection.type === "preset" && selection.preset === "all"
                  ? "solid"
                  : "soft"
              }
              onClick={() => setSelection({ type: "preset", preset: "all" })}
              disabled={loading}
            >
              {t("dashboard.range.buttons.allTime")}
            </Button>
          </Flex>
        </Card>
      </Grid>

      <Box>
        <Heading size="5">{selectionTitle}</Heading>
      </Box>

      <Grid columns={{ initial: "1", sm: "4" }} gap="4">
        <Card>
          <Flex direction="column" gap="3">
            <Text size="2" color="gray">
              {t("dashboard.summary.recording.title")}
            </Text>
            <Heading size="6">{formatDurationMs(summary.durationMs)}</Heading>
            <Text size="2" color="gray">
              {t("dashboard.summary.recording.count", {
                count: summary.entryCount,
              })}
            </Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Text size="2" color="gray">
              {t("dashboard.summary.transcription.title")}
            </Text>
            <Heading size="6">{numberFormat.format(summary.charCount)}</Heading>
            <Text size="2" color="gray">
              {t("dashboard.summary.transcription.speed", {
                rate: Math.round(summary.charsPerMinute),
              })}
            </Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Text size="2" color="gray">
              {t("dashboard.summary.llm.title")}
            </Text>
            <Heading size="6">{numberFormat.format(summary.llmCalls)}</Heading>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">
                {t("dashboard.summary.llm.details", {
                  hitRate: `${(summary.llmHitRate * 100).toFixed(1)}%`,
                })}
              </Text>
            </Flex>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Text size="2" color="gray">
              {t("dashboard.summary.apps.title")}
            </Text>
            <Flex direction="column" gap="1">
              {summary.topApps.length === 0 ? (
                <Text size="2" color="gray">
                  {t("dashboard.summary.apps.empty")}
                </Text>
              ) : (
                summary.topApps.map(([app, count]) => (
                  <Text key={app} size="2">
                    {app} · {numberFormat.format(count)}
                  </Text>
                ))
              )}
            </Flex>
          </Flex>
        </Card>
      </Grid>

      <Card>
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              {t("dashboard.details.title")}
            </Text>
            <Text size="2" color="gray">
              {t("dashboard.details.count", {
                count: selectedEntries.length,
              })}
            </Text>
          </Flex>

          <Box className="relative pb-2">
            {detailGroups.length === 0 ? (
              <Text size="2" color="gray">
                {t("dashboard.details.empty")}
              </Text>
            ) : (
              detailGroups.map(([day, dayEntries]) => (
                <Box key={day} className="relative pt-4">
                  <Box className="bg-mid-gray/5 border border-mid-gray/10 rounded-md px-3 py-2">
                    <Flex justify="between" align="center">
                      <Text size="2" weight="bold" className="text-logo-primary">
                        {day}
                      </Text>
                      <Text size="2" color="gray">
                        {numberFormat.format(selectedDayTotals.get(day) ?? dayEntries.length)}
                      </Text>
                    </Flex>
                  </Box>
                  <Box className="pt-3 space-y-3">
                    {dayEntries.map((entry, idx) => {
                      const timeInfo = formatEntryTime(entry.timestamp);
                      const appName = entry.app_name?.trim();
                      const metaParts: string[] = [];
                      if (typeof entry.duration_ms === "number" && entry.duration_ms > 0) {
                        metaParts.push(formatDurationMs(entry.duration_ms));
                      }
                      if (typeof entry.char_count === "number" && entry.char_count > 0) {
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
                          onRetranscribe={async (id) => {
                            try {
                              await invoke("retranscribe_history_entry", { id });
                            } catch (e) {
                              console.error("Retranscribe invocation failed", e);
                              alert(t("dashboard.actions.retranscribeFailed"));
                            }
                          }}
                        />
                      );
                    })}
                  </Box>
                </Box>
              ))
            )}
            <div ref={detailsSentinelRef} className="h-1 w-full" />
          </Box>

          {detailCount < selectedEntries.length && (
            <Flex justify="center">
              <Button
                variant="soft"
                onClick={() =>
                  setDetailCount((c) =>
                    Math.min(c + DETAIL_PAGE_SIZE, selectedEntries.length),
                  )
                }
              >
                {t("dashboard.details.loadMore")}
              </Button>
            </Flex>
          )}
        </Flex>
      </Card>
    </Flex>
  );
};
