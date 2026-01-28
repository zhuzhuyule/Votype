import {
  Box,
  Button,
  DropdownMenu,
  Flex,
  Heading,
  SegmentedControl,
  Select,
  Text,
} from "@radix-ui/themes";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconDownload,
  IconFileText,
  IconSparkles,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { toLocalYmd } from "../dashboard/dashboardUtils";
import { SummaryCalendar } from "./SummaryCalendar";
import {
  SummaryAppDistribution,
  SummaryHourlyChart,
  SummaryStatsCards,
} from "./SummaryStats";
import { useSummary } from "./hooks/useSummary";
import {
  parseAiAnalysis,
  type PeriodSelection,
  type PeriodType,
  type Summary,
} from "./summaryTypes";

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
    exportSummary,
    generateAiAnalysis,
  } = useSummary();

  const [periodType, setPeriodType] = useState<PeriodType>("day");
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    getPeriodSelection("day"),
  );

  // Load data when selection changes
  useEffect(() => {
    loadSummary(selection);
  }, [selection, loadSummary]);

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
  const { settings, postProcessModelOptions, fetchPostProcessModels } =
    useSettings();

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
    if (!activeProvider) return [];

    // Use cached models instead of fetching all available models
    const cachedModels = settings?.cached_models || [];
    const providerCachedModels = cachedModels
      .filter((m) => m.provider_id === activeProvider.id)
      // Only include text generation models (capability "text-generation" or generic)
      // Assuming all cached models in this context are usable for summary if user added them
      .map((m) => m.model_id);

    // Ensure current model is in the list
    const allModels = [
      ...new Set([...providerCachedModels, currentModel].filter(Boolean)),
    ];

    // If no models found, maybe fallback to showing nothing or a hint?
    // User requested "all text type models we added", which aligns with cached_models.

    return allModels.map((model) => ({ value: model, label: model }));
  }, [activeProvider, settings?.cached_models, currentModel]);

  const handleGenerateAnalysis = useCallback(() => {
    if (!summary) return;
    generateAiAnalysis(summary.id, selectedModel || null);
  }, [summary, selectedModel, generateAiAnalysis]);

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

  return (
    <Box className="w-full max-w-6xl mx-auto">
      <Flex gap="6">
        {/* Sidebar */}
        <Box className="w-80 shrink-0 space-y-6">
          {/* Period Selector */}
          <Box>
            <Text
              size="2"
              weight="medium"
              color="gray"
              mb="2"
              className="block"
            >
              {t("summary.periodSelector.title")}
            </Text>
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

          {/* Stats Cards */}
          <SummaryStatsCards stats={stats} loading={loading} />

          {/* Charts Row */}
          <Flex gap="4">
            <Box className="flex-1">
              <SummaryAppDistribution stats={stats} loading={loading} />
            </Box>
            <Box className="flex-1">
              <SummaryHourlyChart stats={stats} loading={loading} />
            </Box>
          </Flex>

          {/* AI Analysis Section */}
          <Box className="bg-(--gray-2) rounded-lg p-6 border border-(--gray-4)">
            <Flex justify="between" align="center" mb="4">
              <Flex align="center" gap="2">
                <IconSparkles size={20} className="text-(--accent-9)" />
                <Text size="3" weight="medium">
                  {t("summary.aiAnalysis.title")}
                </Text>
              </Flex>
              <Flex align="center" gap="2">
                {modelOptions.length > 0 && (
                  <Select.Root
                    value={selectedModel}
                    onValueChange={setSelectedModel}
                    disabled={generating}
                  >
                    <Select.Trigger
                      placeholder={t("summary.aiAnalysis.selectModel")}
                    />
                    <Select.Content>
                      {modelOptions.map((option) => (
                        <Select.Item key={option.value} value={option.value}>
                          {option.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                )}
                <Button
                  variant="soft"
                  size="2"
                  disabled={generating || !summary}
                  onClick={handleGenerateAnalysis}
                >
                  <IconSparkles size={16} />
                  {generating
                    ? t("summary.aiAnalysis.generating")
                    : t("summary.aiAnalysis.generate")}
                </Button>
              </Flex>
            </Flex>

            {/* Analysis Content */}
            {(() => {
              const analysis = parseAiAnalysis(summary?.ai_summary ?? null);
              if (analysis?.summary) {
                return (
                  <Box className="space-y-4">
                    {/* Activity Summary */}
                    {analysis.summary && (
                      <Box className="bg-(--gray-1) rounded-md p-4 border border-(--gray-3)">
                        <Text size="2" weight="medium" mb="2" className="block">
                          {analysis.summary.title}
                        </Text>
                        {analysis.summary.content && (
                          <Text size="2" color="gray">
                            {analysis.summary.content}
                          </Text>
                        )}
                      </Box>
                    )}

                    {/* Specific Activities */}
                    {analysis.activities?.items &&
                      analysis.activities.items.length > 0 && (
                        <Box className="bg-(--gray-1) rounded-md p-4 border border-(--gray-3)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block"
                          >
                            {analysis.activities.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.activities.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Highlights */}
                    {analysis.highlights?.items &&
                      analysis.highlights.items.length > 0 && (
                        <Box className="bg-(--accent-a2) rounded-md p-4 border border-(--accent-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--accent-11)"
                          >
                            {analysis.highlights.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.highlights.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Work Focus - New extended field */}
                    {analysis.work_focus?.items &&
                      analysis.work_focus.items.length > 0 && (
                        <Box className="bg-(--blue-a2) rounded-md p-4 border border-(--blue-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--blue-11)"
                          >
                            {analysis.work_focus.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.work_focus.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Communication Patterns - New extended field */}
                    {analysis.communication_patterns?.items &&
                      analysis.communication_patterns.items.length > 0 && (
                        <Box className="bg-(--purple-a2) rounded-md p-4 border border-(--purple-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--purple-11)"
                          >
                            {analysis.communication_patterns.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.communication_patterns.items.map(
                              (item, i) => (
                                <li key={i}>
                                  <Text size="2" color="gray">
                                    {item}
                                  </Text>
                                </li>
                              ),
                            )}
                          </ul>
                        </Box>
                      )}

                    {/* Insights - New extended field */}
                    {analysis.insights?.items &&
                      analysis.insights.items.length > 0 && (
                        <Box className="bg-(--green-a2) rounded-md p-4 border border-(--green-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--green-11)"
                          >
                            {analysis.insights.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.insights.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Day-specific: Todos Extracted */}
                    {analysis.todos_extracted?.items &&
                      analysis.todos_extracted.items.length > 0 && (
                        <Box className="bg-(--orange-a2) rounded-md p-4 border border-(--orange-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--orange-11)"
                          >
                            {analysis.todos_extracted.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.todos_extracted.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Day-specific: Focus Assessment */}
                    {analysis.focus_assessment && (
                      <Box className="bg-(--cyan-a2) rounded-md p-4 border border-(--cyan-a4)">
                        <Flex justify="between" align="center" mb="2">
                          <Text
                            size="2"
                            weight="medium"
                            className="text-(--cyan-11)"
                          >
                            {analysis.focus_assessment.title}
                          </Text>
                          <Text
                            size="3"
                            weight="bold"
                            className="text-(--cyan-11)"
                          >
                            {analysis.focus_assessment.score}/10
                          </Text>
                        </Flex>
                        <Text size="2" color="gray">
                          {analysis.focus_assessment.comment}
                        </Text>
                      </Box>
                    )}

                    {/* Week-specific: Patterns */}
                    {analysis.patterns?.items &&
                      analysis.patterns.items.length > 0 && (
                        <Box className="bg-(--violet-a2) rounded-md p-4 border border-(--violet-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--violet-11)"
                          >
                            {analysis.patterns.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.patterns.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Week-specific: Next Week Suggestions */}
                    {analysis.next_week?.items &&
                      analysis.next_week.items.length > 0 && (
                        <Box className="bg-(--amber-a2) rounded-md p-4 border border-(--amber-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--amber-11)"
                          >
                            {analysis.next_week.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.next_week.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Month-specific: Trends */}
                    {analysis.trends?.items &&
                      analysis.trends.items.length > 0 && (
                        <Box className="bg-(--teal-a2) rounded-md p-4 border border-(--teal-a4)">
                          <Text
                            size="2"
                            weight="medium"
                            mb="2"
                            className="block text-(--teal-11)"
                          >
                            {analysis.trends.title}
                          </Text>
                          <ul className="list-disc list-inside space-y-1">
                            {analysis.trends.items.map((item, i) => (
                              <li key={i}>
                                <Text size="2" color="gray">
                                  {item}
                                </Text>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}

                    {/* Model used info */}
                    {summary?.ai_model_used && (
                      <Text size="1" color="gray">
                        {t("summary.aiAnalysis.modelUsed")}:{" "}
                        {summary.ai_model_used}
                      </Text>
                    )}
                  </Box>
                );
              } else if (summary?.ai_summary) {
                // Fallback: display raw text if JSON parsing fails
                return (
                  <Box className="bg-(--gray-1) rounded-md p-4 border border-(--gray-3)">
                    <Text size="2" color="gray" className="whitespace-pre-wrap">
                      {summary.ai_summary}
                    </Text>
                  </Box>
                );
              } else {
                return (
                  <Text size="2" color="gray">
                    {t("summary.aiAnalysis.empty")}
                  </Text>
                );
              }
            })()}
          </Box>

          {/* User Profile Quick View */}
          {userProfile?.style_prompt && (
            <Box className="bg-(--accent-a2) rounded-lg p-4 border border-(--accent-a4)">
              <Text size="2" weight="medium" mb="2" className="block">
                {t("summary.userProfile.currentStyle")}
              </Text>
              <Text size="2" className="italic">
                {userProfile.style_prompt}
              </Text>
            </Box>
          )}
        </Box>
      </Flex>
    </Box>
  );
};
