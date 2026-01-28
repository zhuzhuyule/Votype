import { Box, Flex, Text } from "@radix-ui/themes";
import { IconCalendar, IconSparkles } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PeriodSelection, Summary } from "./summaryTypes";

interface SummaryTimelineProps {
  summaryList: Summary[];
  currentSelection: PeriodSelection | null;
  onSelectSummary: (summary: Summary) => void;
}

function formatPeriodLabel(summary: Summary): string {
  const start = new Date(summary.period_start * 1000);

  if (summary.period_type === "day") {
    return start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  }

  if (summary.period_type === "week") {
    const end = new Date(summary.period_end * 1000);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }

  if (summary.period_type === "month") {
    return start.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }

  return `${start.toLocaleDateString()} - ${new Date(summary.period_end * 1000).toLocaleDateString()}`;
}

export const SummaryTimeline: React.FC<SummaryTimelineProps> = ({
  summaryList,
  currentSelection,
  onSelectSummary,
}) => {
  const { t } = useTranslation();

  const groupedSummaries = useMemo(() => {
    const groups: Record<string, Summary[]> = {
      day: [],
      week: [],
      month: [],
    };

    for (const summary of summaryList) {
      if (groups[summary.period_type]) {
        groups[summary.period_type].push(summary);
      }
    }

    return groups;
  }, [summaryList]);

  const isSelected = (summary: Summary) => {
    if (!currentSelection) return false;
    return (
      summary.period_start === currentSelection.startTs &&
      summary.period_end === currentSelection.endTs
    );
  };

  return (
    <Box className="space-y-4">
      <Text size="2" weight="medium" color="gray">
        {t("summary.timeline.title")}
      </Text>

      {/* Days */}
      {groupedSummaries.day.length > 0 && (
        <Flex direction="column" gap="1">
          {groupedSummaries.day.slice(0, 7).map((summary) => (
            <TimelineItem
              key={summary.id}
              summary={summary}
              selected={isSelected(summary)}
              onClick={() => onSelectSummary(summary)}
            />
          ))}
        </Flex>
      )}

      {/* Weeks */}
      {groupedSummaries.week.length > 0 && (
        <Flex direction="column" gap="1">
          {groupedSummaries.week.slice(0, 4).map((summary) => (
            <TimelineItem
              key={summary.id}
              summary={summary}
              selected={isSelected(summary)}
              onClick={() => onSelectSummary(summary)}
            />
          ))}
        </Flex>
      )}

      {/* Months */}
      {groupedSummaries.month.length > 0 && (
        <Flex direction="column" gap="1">
          {groupedSummaries.month.slice(0, 3).map((summary) => (
            <TimelineItem
              key={summary.id}
              summary={summary}
              selected={isSelected(summary)}
              onClick={() => onSelectSummary(summary)}
            />
          ))}
        </Flex>
      )}

      {summaryList.length === 0 && (
        <Text size="2" color="gray">
          {t("summary.timeline.empty")}
        </Text>
      )}
    </Box>
  );
};

const TimelineItem: React.FC<{
  summary: Summary;
  selected: boolean;
  onClick: () => void;
}> = ({ summary, selected, onClick }) => {
  return (
    <Flex
      align="center"
      justify="between"
      px="3"
      py="2"
      className={`rounded-md cursor-pointer transition-colors ${
        selected
          ? "bg-(--accent-a3) text-(--accent-11)"
          : "hover:bg-(--gray-3) text-(--gray-11)"
      }`}
      onClick={onClick}
    >
      <Flex align="center" gap="2">
        <IconCalendar size={14} />
        <Text size="2">{formatPeriodLabel(summary)}</Text>
      </Flex>
      {summary.ai_summary && (
        <IconSparkles size={14} className="text-(--accent-9)" />
      )}
    </Flex>
  );
};
