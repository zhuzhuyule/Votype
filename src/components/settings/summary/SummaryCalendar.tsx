import { Box, Button, Flex, Grid, IconButton, Text } from "@radix-ui/themes";
import {
  IconChevronLeft,
  IconChevronRight,
  IconSparkles,
} from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
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

  const isMonthMode = periodType === "month";
  const isWeekMode = periodType === "week";
  const isDayMode = periodType === "day";

  // Determine initial view date from selection
  const currentSelected = useMemo(
    () => new Date(selection.startTs * 1000),
    [selection],
  );

  // View state (Month or Year being viewed)
  // For Day/Week mode: tracks start of Month
  // For Year/Month mode: tracks start of Year
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(currentSelected);
    d.setDate(1);
    // Align to Jan if month mode (showing months grid)
    if (isMonthMode) {
      d.setMonth(0);
    }
    return d;
  });

  // Sync view when mode changes
  useEffect(() => {
    if (isMonthMode) {
      setViewDate((d) => {
        const newD = new Date(d);
        newD.setMonth(0);
        newD.setDate(1);
        return newD;
      });
    } else {
      // Switch to Day/Week mode -> Ensure we are viewing the selected month?
      // Maybe better to respect current selection month
      setViewDate((d) => {
        const newD = new Date(d);
        // Current selected might be drastically different?
        // Rely on `currentSelected` if we want reset?
        // But usually we just stay on current browsing view if possible.
        return newD;
      });
    }
  }, [periodType, isMonthMode]);

  const viewMonth = viewDate.getMonth();
  const viewYear = viewDate.getFullYear();

  // Navigation handlers
  const handlePrev = () => {
    if (isMonthMode) {
      // Prev Year
      setViewDate(new Date(viewYear - 1, 0, 1));
    } else {
      // Prev Month
      setViewDate(new Date(viewYear, viewMonth - 1, 1));
    }
  };

  const handleNext = () => {
    if (isMonthMode) {
      // Next Year
      setViewDate(new Date(viewYear + 1, 0, 1));
    } else {
      // Next Month
      setViewDate(new Date(viewYear, viewMonth + 1, 1));
    }
  };

  const jumpToToday = () => {
    const now = new Date();
    if (isMonthMode) {
      setViewDate(new Date(now.getFullYear(), 0, 1));
      onSelectDate(toLocalYmd(now));
    } else {
      setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
      onSelectDate(toLocalYmd(now));
    }
  };

  // --- DAY GRID LOGIC (Day View) ---
  const calendarData = useMemo(() => {
    if (!isDayMode) return [];

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
  }, [viewYear, viewMonth, isDayMode]);

  // --- MONTH GRID LOGIC (Year/Month View) ---
  const yearData = useMemo(() => {
    if (!isMonthMode) return [];

    const monthStatus = new Map<number, boolean>();
    statusMap.forEach((val, key) => {
      if (val.hasSummary) {
        const d = new Date(key);
        if (d.getFullYear() === viewYear) {
          monthStatus.set(d.getMonth(), true);
        }
      }
    });

    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(viewYear, i, 1);
      months.push({
        name: d.toLocaleDateString(undefined, { month: "short" }),
        fullDate: d,
        monthIndex: i,
        hasSummary: monthStatus.get(i) || false,
      });
    }
    return months;
  }, [viewYear, isMonthMode, statusMap]);

  // Helper to check highlights
  const isInSelectionRange = (
    itemYear: number,
    itemMonth: number,
    itemDay: number,
  ) => {
    if (periodType === "day") return false;
    const d = new Date(itemYear, itemMonth, itemDay);
    const ts = d.getTime() / 1000;
    return ts >= selection.startTs && ts < selection.endTs;
  };

  const isMonthInSelectionRange = (monthDate: Date) => {
    const startOfMonth = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth(),
      1,
    );
    const endOfMonth = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    const startTs = startOfMonth.getTime() / 1000;
    const endTs = endOfMonth.getTime() / 1000;

    return startTs <= selection.endTs && endTs >= selection.startTs;
  };

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // --- RENDER ---

  const renderHeader = () => {
    let title = "";
    if (isMonthMode) {
      title = viewYear.toString();
    } else {
      title = viewDate.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
    }

    return (
      <Flex justify="between" align="center" mb="4">
        <Flex align="center" gap="2">
          <Text weight="bold" size="3">
            {title}
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
            onClick={handlePrev}
            className="cursor-pointer"
          >
            <IconChevronLeft size={16} />
          </IconButton>
          <IconButton
            variant="ghost"
            color="gray"
            onClick={handleNext}
            className="cursor-pointer"
          >
            <IconChevronRight size={16} />
          </IconButton>
        </Flex>
      </Flex>
    );
  };

  if (isMonthMode) {
    // --- MONTH VIEW (Grid of Months) ---
    return (
      <Card className="p-4" shadow="sm">
        {renderHeader()}
        <Grid columns="3" gap="2" className="text-center">
          {yearData.map((m) => {
            const isSelected = isMonthInSelectionRange(m.fullDate);
            // In Year Mode, we select the WHOLE YEAR usually.
            // So if we are viewing the selected year, isSelected is true for all.

            const now = new Date();
            const isThisMonth =
              now.getMonth() === m.monthIndex && now.getFullYear() === viewYear;

            const isFuture = m.fullDate.getTime() > now.getTime();
            // Actually fullDate is 1st of month. If 1st is in future...
            // More accurately: if current month < view month (in future year or later month same year)
            // If viewYear > nowYear => All future.
            // If viewYear == nowYear => months > nowMonth are future.
            const isStrictFuture =
              viewYear > now.getFullYear() ||
              (viewYear === now.getFullYear() && m.monthIndex > now.getMonth());

            return (
              <Box key={m.monthIndex} className="relative group p-1">
                <button
                  type="button"
                  disabled={isStrictFuture}
                  onClick={() => onSelectDate(toLocalYmd(m.fullDate))}
                  className={`
                                    w-full py-2 rounded-md text-sm relative transition-all duration-200 border box-border
                                    ${isStrictFuture ? "opacity-20 cursor-not-allowed" : "cursor-pointer hover:bg-(--gray-3)"}
                                    ${isSelected ? "bg-(--accent-3) text-(--accent-11)" : "border-transparent"}
                                    ${isThisMonth && !isSelected ? "border border-(--accent-9)" : ""}
                                `}
                >
                  {m.name}
                  {m.hasSummary && (
                    <div className="absolute top-1 right-1">
                      <IconSparkles size={8} className="text-(--accent-9)" />
                    </div>
                  )}
                </button>
              </Box>
            );
          })}
        </Grid>
      </Card>
    );
  }

  // --- MONTH VIEW ---
  return (
    <Card className="p-4" shadow="sm">
      {renderHeader()}

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
                    // Switch view to that month without changing mode
                    // But if periodType="week", and we click previous month day...
                    // "Week Mode" should allow spanning months.
                    // viewDate update is mostly visual.
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
