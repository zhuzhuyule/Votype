import { Box, Button, Card, Flex, Grid, Text, Tooltip } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import type { DashboardSelection } from "./dashboardTypes";

interface ActivityBar {
  day: string;
  entries: number;
  heightPct: number;
  selected: boolean;
  isToday: boolean;
}

interface DashboardActivityChartProps {
  bars: ActivityBar[];
  selection: DashboardSelection;
  loading?: boolean;
  onSelectDay: (day: string) => void;
  onSelectPreset: (preset: "7d" | "30d" | "all") => void;
}

export const DashboardActivityChart: React.FC<DashboardActivityChartProps> = ({
  bars,
  selection,
  loading = false,
  onSelectDay,
  onSelectPreset,
}) => {
  const { t } = useTranslation();

  return (
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
                  onClick={() => onSelectDay(b.day)}
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
            onClick={() => onSelectPreset("7d")}
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
            onClick={() => onSelectPreset("30d")}
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
            onClick={() => onSelectPreset("all")}
            disabled={loading}
          >
            {t("dashboard.range.buttons.allTime")}
          </Button>
        </Flex>
      </Card>
    </Grid>
  );
};
