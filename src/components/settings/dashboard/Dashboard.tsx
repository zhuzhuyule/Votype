import { Box, Heading } from "@radix-ui/themes";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { DashboardActivityChart } from "./DashboardActivityChart";
import { DashboardDetailsList } from "./DashboardDetailsList";
import { DashboardSummaryCards } from "./DashboardSummaryCards";
import type { DashboardSelection, HistoryEntry } from "./dashboardTypes";
import {
  countUnicodeChars,
  formatDurationMs,
  toLocalYmd,
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

  // Clear audio cache on unmount to free memory
  useEffect(() => {
    return () => {
      audioUrlCacheRef.current.clear();
    };
  }, []);

  const chartDays = useMemo(() => {
    const days: string[] = [];
    for (let i = 39; i >= 0; i--) {
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
    if (selection.preset === "40d" || selection.preset === "all") {
      return new Set(chartDays);
    }
    if (selection.preset === "30d") {
      return new Set(chartDays.slice(-30));
    }
    return new Set(chartDays.slice(-7));
  }, [chartDays, selection]);

  const bars = useMemo(() => {
    const days = chartDays.map((day) => ({
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
  }, [bucketsByDay, chartDays, selectedDays, todayYmd]);

  const selectionTitle = useMemo(() => {
    if (selection.type === "day") {
      if (selection.day === todayYmd) return t("dashboard.range.today");
      return selection.day;
    }
    if (selection.preset === "7d")
      return t("dashboard.range.lastNDays", { days: 7 });
    if (selection.preset === "30d")
      return t("dashboard.range.lastNDays", { days: 30 });
    if (selection.preset === "40d")
      return t("dashboard.range.lastNDays", { days: 40 });
    return t("dashboard.range.allTime");
  }, [selection, t, todayYmd]);

  useEffect(() => {
    setDetailCount(DETAIL_PAGE_SIZE);
  }, [selectionTitle]);

  const selectedEntries = useMemo(() => {
    if (selection.type === "preset" && selection.preset === "all")
      return entries;
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
    <Box className="w-full max-w-5xl mx-auto space-y-8 pb-10">
      <DashboardActivityChart
        bars={bars}
        selection={selection}
        loading={loading}
        onSelectDay={(day) => setSelection({ type: "day", day })}
        onSelectPreset={(preset) => setSelection({ type: "preset", preset })}
      />

      <Heading size="5" mb="4">
        {selectionTitle}
      </Heading>
      <DashboardSummaryCards
        summary={summary}
        numberFormat={numberFormat}
        formatDurationMs={formatDurationMs}
      />

      <DashboardDetailsList
        entries={detailEntries}
        totalCount={selectedEntries.length}
        selectionTitle={selectionTitle}
        selectedDayTotals={selectedDayTotals}
        getAudioUrl={getAudioUrl}
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
        onLoadMore={() =>
          setDetailCount((c) =>
            Math.min(c + DETAIL_PAGE_SIZE, selectedEntries.length),
          )
        }
        detailCount={detailCount}
        formatDurationMs={formatDurationMs}
        numberFormat={numberFormat}
        t={t}
      />
    </Box>
  );
};
