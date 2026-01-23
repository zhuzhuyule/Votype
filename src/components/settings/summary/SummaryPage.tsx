import {
  Box,
  Button,
  DropdownMenu,
  Flex,
  Heading,
  SegmentedControl,
  Text,
} from "@radix-ui/themes";
import {
  IconCode,
  IconDownload,
  IconFileText,
  IconSparkles,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SummaryAppDistribution,
  SummaryHourlyChart,
  SummaryStatsCards,
} from "./SummaryStats";
import { SummaryTimeline } from "./SummaryTimeline";
import { useSummary } from "./hooks/useSummary";
import type { PeriodSelection, PeriodType, Summary } from "./summaryTypes";

function getPeriodSelection(
  type: PeriodType,
  customStart?: number,
  customEnd?: number,
): PeriodSelection {
  const now = new Date();
  let startTs: number;
  let endTs: number;
  let label: string;

  switch (type) {
    case "day": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(now.getTime() / 1000);
      label = "Today";
      break;
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(now.getTime() / 1000);
      label = "This Week";
      break;
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(now.getTime() / 1000);
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

  const handleSelectSummary = useCallback((summary: Summary) => {
    setSelection({
      type: summary.period_type as PeriodType,
      startTs: summary.period_start,
      endTs: summary.period_end,
      label: summary.period_type,
    });
  }, []);

  return (
    <Box className="w-full max-w-6xl mx-auto">
      <Flex gap="6">
        {/* Sidebar */}
        <Box className="w-56 shrink-0">
          {/* Period Selector */}
          <Box mb="6">
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
              onValueChange={handlePeriodChange}
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

          {/* Timeline */}
          <SummaryTimeline
            summaryList={summaryList}
            currentSelection={selection}
            onSelectSummary={handleSelectSummary}
          />
        </Box>

        {/* Main Content */}
        <Box className="flex-1 space-y-6">
          {/* Header */}
          <Flex justify="between" align="center">
            <Heading size="5">{selection.label}</Heading>
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
              <Button variant="soft" size="2" disabled={generating}>
                <IconSparkles size={16} />
                {generating
                  ? t("summary.aiAnalysis.generating")
                  : t("summary.aiAnalysis.generate")}
              </Button>
            </Flex>

            {summary?.ai_summary ? (
              <Box className="space-y-4">
                <Box className="bg-(--gray-1) rounded-md p-4 border border-(--gray-3)">
                  <Text size="2" weight="medium" mb="2" className="block">
                    {t("summary.aiAnalysis.communicationStyle")}
                  </Text>
                  <Text size="2" color="gray">
                    {summary.ai_summary}
                  </Text>
                </Box>

                {summary.ai_reflection && (
                  <Box className="bg-(--gray-1) rounded-md p-4 border border-(--gray-3)">
                    <Text size="2" weight="medium" mb="2" className="block">
                      {t("summary.aiAnalysis.reflection")}
                    </Text>
                    <Text size="2" color="gray">
                      {summary.ai_reflection}
                    </Text>
                  </Box>
                )}

                <Flex justify="end" gap="2">
                  <Button variant="ghost" size="1">
                    {t("summary.aiAnalysis.updateProfile")}
                  </Button>
                </Flex>
              </Box>
            ) : (
              <Text size="2" color="gray">
                {t("summary.aiAnalysis.empty")}
              </Text>
            )}
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
