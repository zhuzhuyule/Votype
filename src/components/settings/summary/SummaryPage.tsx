import {
  Badge,
  Box,
  Button,
  DropdownMenu,
  Flex,
  Grid,
  Heading,
  SegmentedControl,
  Text,
} from "@radix-ui/themes";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCode,
  IconDownload,
  IconFileText,
  IconFlag3,
  IconRouteAltLeft,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { AiAnalysisSection } from "./AiAnalysisSection";
import { SummaryCalendar } from "./SummaryCalendar";
import {
  SummaryAppDistribution,
  SummaryHourlyChart,
  SummaryStatsCards,
} from "./SummaryStats";
import { useSummary } from "./hooks/useSummary";
import {
  type DailyOverview,
  type PeriodSelection,
  type PeriodType,
  type Summary,
  type TaskCluster,
} from "./summaryTypes";

// Helper for local YMD (moved from SummaryCalendar or duplicated)
const toLocalYmd = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

function formatDurationShort(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
}

const SummaryRecapSection: React.FC<{
  overview?: DailyOverview | null;
  tasks?: TaskCluster[];
  loading: boolean;
}> = ({ overview, tasks = [], loading }) => {
  const { t } = useTranslation();

  if (loading && !overview && tasks.length === 0) {
    return (
      <Grid columns="2" gap="4">
        <Box className="rounded-2xl border border-(--gray-5) bg-(--gray-2) h-48 animate-pulse" />
        <Box className="rounded-2xl border border-(--gray-5) bg-(--gray-2) h-48 animate-pulse" />
      </Grid>
    );
  }

  if (!overview && tasks.length === 0) {
    return (
      <Box className="rounded-2xl border border-(--gray-5) bg-linear-to-br from-(--gray-1) to-(--gray-2) p-5">
        <Text size="2" color="gray">
          {t("summary.recap.empty")}
        </Text>
      </Box>
    );
  }

  return (
    <Grid columns="2" gap="4">
      <Box className="rounded-2xl border border-sky-200/60 bg-linear-to-br from-sky-50 to-cyan-50 p-5 shadow-sm dark:border-sky-900/40 dark:from-sky-950/20 dark:to-cyan-950/10">
        <Flex align="center" gap="2" mb="3">
          <Box className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
            <IconFlag3 size={16} />
          </Box>
          <Heading size="4">{t("summary.recap.title")}</Heading>
        </Flex>
        {overview?.headline ? (
          <Text size="3" className="block leading-6 text-(--gray-12)">
            {overview.headline}
          </Text>
        ) : null}
        {overview?.key_progress?.length ? (
          <Box mt="4">
            <Text
              size="2"
              weight="medium"
              className="mb-2 block text-(--gray-11)"
            >
              {t("summary.recap.progress")}
            </Text>
            <Flex direction="column" gap="2">
              {overview.key_progress.slice(0, 3).map((item) => (
                <Flex key={item} align="start" gap="2">
                  <IconCircleCheck
                    size={16}
                    className="mt-0.5 shrink-0 text-emerald-600"
                  />
                  <Text size="2" className="leading-5">
                    {item}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Box>
        ) : null}
        {overview?.friction_points?.length ? (
          <Box mt="4">
            <Text
              size="2"
              weight="medium"
              className="mb-2 block text-(--gray-11)"
            >
              {t("summary.recap.friction")}
            </Text>
            <Flex direction="column" gap="2">
              {overview.friction_points.slice(0, 3).map((item) => (
                <Flex key={item} align="start" gap="2">
                  <IconRouteAltLeft
                    size={16}
                    className="mt-0.5 shrink-0 text-amber-600"
                  />
                  <Text size="2" className="leading-5">
                    {item}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Box>
        ) : null}
        {overview?.next_focus ? (
          <Box mt="4" className="rounded-xl bg-white/70 p-3 dark:bg-black/10">
            <Text
              size="1"
              weight="medium"
              className="mb-1 block uppercase tracking-wide text-(--gray-10)"
            >
              {t("summary.recap.nextFocus")}
            </Text>
            <Text size="2">{overview.next_focus}</Text>
          </Box>
        ) : null}
      </Box>

      <Flex direction="column" gap="3">
        {tasks.slice(0, 4).map((task) => (
          <Box
            key={`${task.title}-${task.time_span}`}
            className="rounded-2xl border border-(--gray-5) bg-linear-to-br from-white to-(--gray-1) p-4 shadow-sm dark:from-(--gray-2) dark:to-(--gray-1)"
          >
            <Flex justify="between" align="start" gap="3">
              <Box className="min-w-0">
                <Heading size="3" className="mb-1">
                  {task.title}
                </Heading>
                <Flex wrap="wrap" gap="2" align="center">
                  <Badge
                    color={task.status === "卡住" ? "amber" : "blue"}
                    variant="soft"
                  >
                    {task.status}
                  </Badge>
                  <Text size="1" color="gray">
                    {task.time_span}
                  </Text>
                  <Text size="1" color="gray">
                    {formatDurationShort(task.total_duration_ms)}
                  </Text>
                </Flex>
              </Box>
              <Badge color="gray" variant="surface">
                {task.entry_count} {t("summary.recap.records")}
              </Badge>
            </Flex>

            <Text size="2" className="mt-3 block leading-5 text-(--gray-11)">
              {task.summary}
            </Text>

            {task.apps.length ? (
              <Flex wrap="wrap" gap="2" mt="3">
                {task.apps.map((app) => (
                  <Badge key={app} color="gray" variant="soft">
                    {app}
                  </Badge>
                ))}
              </Flex>
            ) : null}

            {task.blockers.length ? (
              <Box mt="3">
                <Text
                  size="1"
                  weight="medium"
                  className="mb-1 block uppercase tracking-wide text-amber-700 dark:text-amber-400"
                >
                  {t("summary.recap.blockers")}
                </Text>
                <Text size="2">{task.blockers.join(" / ")}</Text>
              </Box>
            ) : null}

            {task.next_step ? (
              <Box mt="3" className="rounded-xl bg-(--accent-2) p-3">
                <Text
                  size="1"
                  weight="medium"
                  className="mb-1 block uppercase tracking-wide text-(--gray-10)"
                >
                  {t("summary.recap.nextStep")}
                </Text>
                <Text size="2">{task.next_step}</Text>
              </Box>
            ) : null}
          </Box>
        ))}
      </Flex>
    </Grid>
  );
};

function getPeriodSelection(
  type: PeriodType,
  customStart?: number,
  customEnd?: number,
): PeriodSelection {
  const now = new Date();
  let startTs = 0;
  let endTs = 0;
  let label = "";

  switch (type) {
    case "day": {
      // Start: 00:00:00 of today
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      // End: 23:59:59 of today (normalized for consistent lookup)
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(end.getTime() / 1000);
      label = "Today";
      break;
    }
    case "week": {
      // Start: 00:00:00 of Sunday (start of week)
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      // End: 23:59:59 of Saturday (end of week)
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(end.getTime() / 1000);
      label = "This Week";
      break;
    }
    case "month": {
      // Start: 00:00:00 of first day of month
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      // End: 23:59:59 of last day of month
      const end = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(end.getTime() / 1000);
      label = "This Month";
      break;
    }
    case "custom": {
      startTs = customStart || Math.floor(now.getTime() / 1000) - 86400 * 7;
      endTs = customEnd || Math.floor(now.getTime() / 1000);
      label = "Custom Range";
      break;
    }
  }

  return { type, startTs, endTs, label };
}

export const SummaryPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    stats,
    summary,
    summaryList,
    userProfile,
    loading,
    generating,
    loadSummary,
    deleteSummaryHistoryEntry,
    exportSummary,
    generateAiAnalysis,
  } = useSummary();

  const [periodType, setPeriodType] = useState<PeriodType>("day");
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    getPeriodSelection("day"),
  );

  // History selection state
  const [selectedHistoryTimestamp, setSelectedHistoryTimestamp] = useState<
    number | null
  >(null);

  // Load data when selection changes
  useEffect(() => {
    loadSummary(selection);
  }, [selection, loadSummary]);

  // Reset history selection when summary changes (e.g. re-generated or period changed)
  useEffect(() => {
    setSelectedHistoryTimestamp(null);
  }, [summary]);

  const handlePeriodChange = useCallback((value: string) => {
    const type = value as PeriodType;
    setPeriodType(type);
    setSelection(getPeriodSelection(type));
  }, []);

  // Navigate to previous period
  const handlePrevPeriod = useCallback(() => {
    setSelection((prev) => {
      const startDate = new Date(prev.startTs * 1000);
      let newStart: Date;
      let newEnd: Date;
      let label: string;

      switch (prev.type) {
        case "day": {
          newStart = new Date(startDate);
          newStart.setDate(newStart.getDate() - 1);
          newStart.setHours(0, 0, 0, 0);
          newEnd = new Date(newStart);
          newEnd.setHours(23, 59, 59, 999);
          label = newStart.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            weekday: "short",
          });
          break;
        }
        case "week": {
          newStart = new Date(startDate);
          newStart.setDate(newStart.getDate() - 7);
          newStart.setHours(0, 0, 0, 0);
          newEnd = new Date(newStart);
          newEnd.setDate(newEnd.getDate() + 6);
          newEnd.setHours(23, 59, 59, 999);
          label = `${newStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${newEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
          break;
        }
        case "month": {
          newStart = new Date(
            startDate.getFullYear(),
            startDate.getMonth() - 1,
            1,
          );
          newEnd = new Date(
            newStart.getFullYear(),
            newStart.getMonth() + 1,
            0,
            23,
            59,
            59,
            999,
          );
          label = newStart.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          });
          break;
        }
        default:
          return prev;
      }

      return {
        type: prev.type,
        startTs: Math.floor(newStart.getTime() / 1000),
        endTs: Math.floor(newEnd.getTime() / 1000),
        label,
      };
    });
  }, []);

  // Navigate to next period
  const handleNextPeriod = useCallback(() => {
    setSelection((prev) => {
      const startDate = new Date(prev.startTs * 1000);
      const now = new Date();
      let newStart: Date;
      let newEnd: Date;
      let label: string;

      switch (prev.type) {
        case "day": {
          newStart = new Date(startDate);
          newStart.setDate(newStart.getDate() + 1);
          // Don't go beyond today
          if (newStart > now) return prev;
          newStart.setHours(0, 0, 0, 0);
          newEnd = new Date(newStart);
          newEnd.setHours(23, 59, 59, 999);
          label = newStart.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            weekday: "short",
          });
          break;
        }
        case "week": {
          newStart = new Date(startDate);
          newStart.setDate(newStart.getDate() + 7);
          // Don't go beyond current week
          if (newStart > now) return prev;
          newStart.setHours(0, 0, 0, 0);
          newEnd = new Date(newStart);
          newEnd.setDate(newEnd.getDate() + 6);
          newEnd.setHours(23, 59, 59, 999);
          label = `${newStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${newEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
          break;
        }
        case "month": {
          newStart = new Date(
            startDate.getFullYear(),
            startDate.getMonth() + 1,
            1,
          );
          // Don't go beyond current month
          if (newStart > now) return prev;
          newEnd = new Date(
            newStart.getFullYear(),
            newStart.getMonth() + 1,
            0,
            23,
            59,
            59,
            999,
          );
          label = newStart.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          });
          break;
        }
        default:
          return prev;
      }

      return {
        type: prev.type,
        startTs: Math.floor(newStart.getTime() / 1000),
        endTs: Math.floor(newEnd.getTime() / 1000),
        label,
      };
    });
  }, []);

  // Check if we can go to next period (not beyond current)
  const canGoNext = useCallback(() => {
    const now = new Date();
    const currentStart = getPeriodSelection(selection.type);
    return selection.startTs < currentStart.startTs;
  }, [selection]);

  const handleSelectSummary = useCallback((summary: Summary) => {
    setSelection({
      type: summary.period_type as PeriodType,
      startTs: summary.period_start,
      endTs: summary.period_end,
      label: summary.period_type,
    });
  }, []);

  // Model selection for AI analysis
  const {
    settings,
    postProcessModelOptions,
    fetchPostProcessModels,
    updatePostProcessModel,
    setPostProcessProvider,
  } = useSettings();

  const activeProvider = useMemo(() => {
    const providerId = settings?.post_process_provider_id;
    return settings?.post_process_providers?.find((p) => p.id === providerId);
  }, [settings]);

  const currentModel = useMemo(() => {
    if (!activeProvider) return "";
    return settings?.post_process_models?.[activeProvider.id] ?? "";
  }, [activeProvider, settings?.post_process_models]);

  const [selectedModel, setSelectedModel] = useState<string>("");

  // Update selected model when current model changes
  useEffect(() => {
    if (currentModel && !selectedModel) {
      setSelectedModel(currentModel);
    }
  }, [currentModel, selectedModel]);

  // Fetch models on mount
  useEffect(() => {
    if (activeProvider && activeProvider.id !== "apple_intelligence") {
      fetchPostProcessModels(activeProvider.id).catch(console.error);
    }
  }, [activeProvider, fetchPostProcessModels]);

  const modelOptions = useMemo(() => {
    // Return all cached text generation models from all providers
    const cachedModels = settings?.cached_models || [];

    // Filter for text models
    const textModels = cachedModels.filter(
      (m) => m.model_type === "text" || m.model_type === "other",
    );

    // Map to Dropdown options
    let options = textModels.map((m) => ({
      value: m.model_id,
      label: m.custom_label ? (
        <Flex gap="2" align="center">
          <Text>{m.model_id}</Text>
          <Badge color="gray" variant="soft" radius="full">
            {m.custom_label}
          </Badge>
        </Flex>
      ) : (
        m.model_id
      ),
      searchValue: m.custom_label
        ? `${m.model_id} ${m.custom_label}`
        : m.model_id,
    }));

    // Ensure current model is in the list (fallback if not in cache)
    if (currentModel && !options.some((o) => o.value === currentModel)) {
      options.push({
        value: currentModel,
        label: currentModel,
        searchValue: currentModel,
      });
    }

    // Deduplicate by value (legacy behavior, though duplicate IDs with diff aliases might be an issue,
    // for now we stick to unique Model IDs for valid selection)
    const uniqueOptions = [];
    const seen = new Set();
    for (const opt of options) {
      if (!seen.has(opt.value)) {
        seen.add(opt.value);
        uniqueOptions.push(opt);
      }
    }

    return uniqueOptions;
  }, [settings?.cached_models, currentModel]);

  // Prepare status map for calendar
  const calendarStatusMap = useMemo(() => {
    const map = new Map<string, { hasData: boolean; hasSummary: boolean }>();
    summaryList.forEach((s) => {
      // Only consider days for calendar dots for now
      if (s.period_type === "day") {
        const date = new Date(s.period_start * 1000);
        const ymd = toLocalYmd(date);
        const current = map.get(ymd) || { hasData: false, hasSummary: false };
        // If a summary exists, it has data + summary
        current.hasData = true;
        current.hasSummary = !!s.ai_summary;
        map.set(ymd, current);
      }
    });
    return map;
  }, [summaryList]);

  const selectedDateYmd = useMemo(() => {
    if (selection.type === "day") {
      return toLocalYmd(new Date(selection.startTs * 1000));
    }
    return "";
  }, [selection]);

  const handleCalendarSelect = useCallback((dateStr: string) => {
    const start = new Date(dateStr);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dateStr);
    end.setHours(23, 59, 59, 999);

    setPeriodType("day");
    setSelection({
      type: "day",
      startTs: Math.floor(start.getTime() / 1000),
      endTs: Math.floor(end.getTime() / 1000),
      label: start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        weekday: "short",
      }),
    });
  }, []);

  const handleModelChange = useCallback(
    async (val: string) => {
      setSelectedModel(val);

      // Find which provider owns this model
      const cachedModels = settings?.cached_models || [];
      const targetModel = cachedModels.find((m) => m.model_id === val);

      if (targetModel) {
        // Switch provider if needed
        if (settings?.post_process_provider_id !== targetModel.provider_id) {
          await setPostProcessProvider(targetModel.provider_id);
        }
        // Update model for that provider
        await updatePostProcessModel(targetModel.provider_id, val);
      } else if (activeProvider) {
        // Fallback: update for current provider if model not found in cache (e.g. manually entered or generic)
        await updatePostProcessModel(activeProvider.id, val);
      }
    },
    [
      settings?.cached_models,
      settings?.post_process_provider_id,
      activeProvider,
      setPostProcessProvider,
      updatePostProcessModel,
    ],
  );

  return (
    <Box className="w-full max-w-6xl mx-auto">
      <Flex gap="6">
        {/* Sidebar */}
        <Box className="w-80 shrink-0 space-y-6">
          {/* Period Selector */}
          <Box>
            <SegmentedControl.Root
              value={periodType}
              onValueChange={(val) => {
                const type = val as PeriodType;
                setPeriodType(type);
                // If switching to Month, select current view month?
                // Logic will be handled in Calendar or here?
                // For now just switch type.
              }}
              size="1"
            >
              <SegmentedControl.Item value="day">
                {t("summary.periodSelector.day")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="week">
                {t("summary.periodSelector.week")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="month">
                {t("summary.periodSelector.month")}
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </Box>

          {/* Calendar */}
          <SummaryCalendar
            selectedDate={selectedDateYmd}
            onSelectDate={(date) => {
              // If in day mode, simple select
              if (periodType === "day") {
                handleCalendarSelect(date);
              } else if (periodType === "week") {
                // Calculate week range for the clicked date
                const d = new Date(date); // YYYY-MM-DD local
                const start = new Date(d);
                start.setDate(start.getDate() - start.getDay()); // Sunday
                start.setHours(0, 0, 0, 0);
                const end = new Date(start);
                end.setDate(end.getDate() + 6); // Saturday
                end.setHours(23, 59, 59, 999);

                setSelection({
                  type: "week",
                  startTs: Math.floor(start.getTime() / 1000),
                  endTs: Math.floor(end.getTime() / 1000),
                  label: `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
                });
              } else if (periodType === "month") {
                // If in month mode, select the month containing this date
                const d = new Date(date);
                const start = new Date(d.getFullYear(), d.getMonth(), 1);
                const end = new Date(
                  d.getFullYear(),
                  d.getMonth() + 1,
                  0,
                  23,
                  59,
                  59,
                  999,
                );

                setSelection({
                  type: "month",
                  startTs: Math.floor(start.getTime() / 1000),
                  endTs: Math.floor(end.getTime() / 1000),
                  label: start.toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  }),
                });
              }
            }}
            statusMap={calendarStatusMap}
            periodType={periodType}
            selection={selection}
          />
        </Box>

        {/* Main Content */}
        <Box className="flex-1 space-y-6">
          {/* Header */}
          <Flex justify="between" align="center">
            <Flex align="center" gap="2">
              <Button variant="ghost" size="1" onClick={handlePrevPeriod}>
                <IconChevronLeft size={18} />
              </Button>
              <Heading size="5">{selection.label}</Heading>
              <Button
                variant="ghost"
                size="1"
                onClick={handleNextPeriod}
                disabled={!canGoNext()}
              >
                <IconChevronRight size={18} />
              </Button>
            </Flex>
            <Flex gap="2">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <Button variant="soft" size="2">
                    <IconDownload size={16} />
                    {t("summary.actions.export")}
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    onClick={() =>
                      summary && exportSummary(summary.id, "markdown")
                    }
                    disabled={!summary}
                  >
                    <IconFileText size={14} />
                    {t("summary.export.markdown")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onClick={() => summary && exportSummary(summary.id, "json")}
                    disabled={!summary}
                  >
                    <IconCode size={14} />
                    {t("summary.export.json")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Flex>
          </Flex>

          <SummaryRecapSection
            overview={summary?.stats.daily_overview}
            tasks={summary?.stats.task_clusters}
            loading={loading}
          />

          {/* Stats & Charts Grid */}
          <Grid
            columns="4"
            gap="4"
            className={loading ? "opacity-50 pointer-events-none" : ""}
          >
            {/* Stats Cards (4 items) */}
            <SummaryStatsCards stats={stats} loading={loading} />

            {/* Charts Row (2 items, span 2 each) */}
            <Box className="col-span-2 h-full">
              <SummaryAppDistribution stats={stats} loading={loading} />
            </Box>
            <Box className="col-span-2 h-full">
              <SummaryHourlyChart stats={stats} loading={loading} />
            </Box>
          </Grid>

          {/* AI Analysis Section */}
        </Box>
      </Flex>

      {/* Bottom Section: AI Analysis & User Profile */}
      <AiAnalysisSection
        summary={summary}
        userProfile={userProfile}
        generating={generating}
        generateAiAnalysis={generateAiAnalysis}
        deleteSummaryHistoryEntry={deleteSummaryHistoryEntry}
        modelOptions={modelOptions}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
      />
    </Box>
  );
};
