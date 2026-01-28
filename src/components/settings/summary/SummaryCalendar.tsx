import { Box, Button, Flex, Grid, IconButton, Text } from "@radix-ui/themes";
import {
  IconChevronLeft,
  IconChevronRight,
  IconSparkles,
} from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../ui/Card";
import { toLocalYmd } from "../dashboard/dashboardUtils";
import type { PeriodSelection, PeriodType } from "./summaryTypes";

interface SummaryCalendarProps {
  selectedDate: string; // Used for "day" mode visual
  onSelectDate: (date: string) => void;
  // Map of YYYY-MM-DD to status flags
  statusMap?: Map<string, { hasData: boolean; hasSummary: boolean }>;
  periodType: PeriodType;
  selection: PeriodSelection;
}

export const SummaryCalendar: React.FC<SummaryCalendarProps> = ({
  selectedDate,
  onSelectDate,
  statusMap = new Map(),
  periodType,
  selection,
}) => {
  const { t } = useTranslation();

  // Determine initial view date from selection
  const currentSelected = useMemo(
    () => new Date(selection.startTs * 1000),
    [selection],
  );

  // View state (Month being viewed)
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(currentSelected);
    d.setDate(1);
    return d;
  });

  const viewMonth = viewDate.getMonth();
  const viewYear = viewDate.getFullYear();

  // Sync view when selection changes significantly (e.g. Month changed externally)
  // But be careful not to jump around if user is browsing
  // For now, let's keep manual navigation dominant unless mode switches.

  // Navigation handlers
  const prevMonth = () => {
    setViewDate(new Date(viewYear, viewMonth - 1, 1));
    if (periodType === "month") {
      // Logic for implicit selection could go here
      const newDate = new Date(viewYear, viewMonth - 1, 1);
      onSelectDate(toLocalYmd(newDate));
    }
  };

  const nextMonth = () => {
    setViewDate(new Date(viewYear, viewMonth + 1, 1));
    if (periodType === "month") {
      const newDate = new Date(viewYear, viewMonth + 1, 1);
      onSelectDate(toLocalYmd(newDate));
    }
  };

  const jumpToToday = () => {
    const now = new Date();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
    onSelectDate(toLocalYmd(now));
  };

  // Calendar generation logic
  const calendarData = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const lastDayOfMonth = new Date(viewYear, viewMonth + 1, 0);
    const startDayOfWeek = firstDayOfMonth.getDay(); // 0=Sun
    const daysInMonth = lastDayOfMonth.getDate();

    const prevMonthDays = [];
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      prevMonthDays.push({
        day: prevMonthLastDay - i,
        month: viewMonth - 1,
        year: viewYear,
        isCurrentMonth: false,
      });
    }

    const currentMonthDays = [];
    for (let i = 1; i <= daysInMonth; i++) {
      currentMonthDays.push({
        day: i,
        month: viewMonth,
        year: viewYear,
        isCurrentMonth: true,
      });
    }

    const totalDays = prevMonthDays.length + currentMonthDays.length;
    const remaining = 7 - (totalDays % 7);
    const nextMonthDays = [];
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        nextMonthDays.push({
          day: i,
          month: viewMonth + 1,
          year: viewYear,
          isCurrentMonth: false,
        });
      }
    }

    return [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];
  }, [viewYear, viewMonth]);

  // Helper to check if a day falls within the selected period (Week/Month)
  const isInSelectionRange = (
    itemYear: number,
    itemMonth: number,
    itemDay: number,
  ) => {
    if (periodType === "day") return false;

    // Compare day start time vs selection range
    const d = new Date(itemYear, itemMonth, itemDay);
    const ts = d.getTime() / 1000;
    // Add 12 hours to avoid timezone edge cases around midnight if simple comparison?
    // Actually selection.startTs / endTs are usually set to 00:00 and 23:59 local.
    // Let's use simple logic:
    // If ts >= startTs and ts <= endTs - roughly
    // Note: selection.endTs is inclusive (23:59:59)

    // Let's align to midnight
    // We construct date using local year/month/day
    // selection.startTs should effectively be start of day

    // Only consider checking "range" if we have valid range
    return ts >= selection.startTs && ts < selection.endTs;
  };

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <Card className="p-4" shadow="sm">
      {/* Header: Month Year + Nav */}
      <Flex justify="between" align="center" mb="4">
        <Flex align="center" gap="2">
          <Text weight="bold" size="3">
            {viewDate.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </Text>
          <Button
            variant="ghost"
            size="1"
            className="cursor-pointer text-gray-500 hover:text-gray-900"
            onClick={jumpToToday}
          >
            {t("dashboard.range.today", "Today")}
          </Button>
        </Flex>
        <Flex gap="1">
          <IconButton
            variant="ghost"
            color="gray"
            onClick={prevMonth}
            className="cursor-pointer"
          >
            <IconChevronLeft size={16} />
          </IconButton>
          <IconButton
            variant="ghost"
            color="gray"
            onClick={nextMonth}
            className="cursor-pointer"
          >
            <IconChevronRight size={16} />
          </IconButton>
        </Flex>
      </Flex>

      {/* Grid */}
      <Grid columns="7" gap="1" className="text-center">
        {/* Weekday Headers */}
        {weekDays.map((d) => (
          <Text key={d} size="1" color="gray" className="mb-2 opacity-70">
            {d}
          </Text>
        ))}

        {/* Calendar Days */}
        {calendarData.map((item, idx) => {
          const itemDate = new Date(item.year, item.month, item.day);
          const ymd = toLocalYmd(itemDate);

          const isSelectedDay = periodType === "day" && ymd === selectedDate;
          const isInRange = isInSelectionRange(item.year, item.month, item.day);

          const now = new Date();
          const todayYmd = toLocalYmd(now);
          const isToday = ymd === todayYmd;

          const compareDate = new Date(item.year, item.month, item.day);
          const todayDate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
          );
          const isFuture = compareDate > todayDate;

          const status = statusMap.get(ymd);
          const hasSummary = status?.hasSummary;

          // Selection Visuals
          const isSolidSelection = isSelectedDay;
          const isRangeSelection = isInRange;

          return (
            <Box key={`${ymd}-${idx}`} className="aspect-square relative group">
              <button
                type="button"
                disabled={isFuture}
                onClick={() => {
                  onSelectDate(ymd);
                  if (!item.isCurrentMonth) {
                    setViewDate(new Date(item.year, item.month, 1));
                  }
                }}
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center mx-auto text-xs relative
                  transition-all duration-200 border box-border
                  ${
                    isFuture
                      ? "opacity-20 cursor-not-allowed"
                      : isSolidSelection || isToday || isRangeSelection
                        ? "cursor-pointer"
                        : "cursor-pointer hover:bg-(--gray-3)"
                  }
                  ${
                    isSolidSelection
                      ? "border-(--accent-9) text-(--accent-11)"
                      : "border-transparent"
                  }
                  ${
                    isRangeSelection && !isSolidSelection
                      ? "bg-(--accent-3) text-(--accent-11)" // Range highlight
                      : ""
                  }
                  ${
                    isToday && !isSolidSelection && !isRangeSelection
                      ? "bg-(--accent-3) text-(--accent-11) font-bold"
                      : ""
                  }
                  ${!item.isCurrentMonth && !isFuture ? "opacity-30" : ""}
                `}
              >
                {item.day}

                {/* Indicators - Only show magic icon if summary exists */}
                {hasSummary && !isSolidSelection && !isRangeSelection && (
                  <div className="absolute -top-1 -right-1">
                    <IconSparkles size={10} className="text-(--accent-9)" />
                  </div>
                )}
              </button>
            </Box>
          );
        })}
      </Grid>
    </Card>
  );
};
