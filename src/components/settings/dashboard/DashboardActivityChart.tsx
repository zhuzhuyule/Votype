import { Flex, SegmentedControl, Text, Tooltip } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
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
  onSelectPreset: (preset: "7d" | "30d" | "40d" | "all") => void;
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
    <SettingsGroup
      title={
        <Text>
          {t("dashboard.activity.title")}
          <Text size="2" color="gray" className="pl-2 opacity-50">
            {t("dashboard.activity.subtitle")}
          </Text>
        </Text>
      }
      cardProps={{ shadow: "sm" }}
      description=""
      actions={
        <SegmentedControl.Root
          value={selection.type === "preset" ? selection.preset : "null"}
          onValueChange={(val) =>
            onSelectPreset(val as "7d" | "30d" | "40d" | "all")
          }
          size="1"
        >
          <SegmentedControl.Item value="7d">
            {t("dashboard.range.buttons.last7Days")}
          </SegmentedControl.Item>
          <SegmentedControl.Item value="30d">
            {t("dashboard.range.buttons.last30Days")}
          </SegmentedControl.Item>
          <SegmentedControl.Item value="40d">
            {t("dashboard.range.buttons.last40Days")}
          </SegmentedControl.Item>
          <SegmentedControl.Item value="all">
            {t("dashboard.range.buttons.allTime")}
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      }
    >
      <Flex gap="2" align="end" className="h-16 mt-2">
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
              className="flex-1 rounded-sm transition-all hover:border-2 hover:border-logo-primary!"
              style={{
                height: `${Math.max(4, b.heightPct)}%`,
                backgroundColor: b.selected
                  ? "var(--accent-9)"
                  : "var(--gray-a6)",
                opacity: b.entries === 0 ? 0.2 : 0.9,
                cursor: "pointer",
                transform: b.isToday ? "translateY(-2px)" : undefined,
                boxShadow: b.isToday
                  ? "0 6px 16px rgba(0,0,0,0.08)"
                  : undefined,
                border: "2px solid transparent",
              }}
              onClick={() => onSelectDay(b.day)}
            />
          </Tooltip>
        ))}
      </Flex>

      <Flex justify="between" mt="2">
        <Text size="1" color="gray">
          {bars[0]?.day ?? ""}
        </Text>
        <Text size="1" color="gray">
          {bars[bars.length - 1]?.day ?? ""}
        </Text>
      </Flex>
    </SettingsGroup>
  );
};
