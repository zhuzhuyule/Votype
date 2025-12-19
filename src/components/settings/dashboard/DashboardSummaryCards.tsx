import { Box, Card, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import {
  IconApps,
  IconCpu,
  IconFileText,
  IconMicrophone,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

interface DashboardSummary {
  entryCount: number;
  durationMs: number;
  charCount: number;
  transcriptionMs: number;
  rtf: number;
  savedCount: number;
  llmCalls: number;
  llmHits: number;
  llmHitRate: number;
  charsPerMinute: number;
  topApps: [string, number][];
}

interface DashboardSummaryCardsProps {
  summary: DashboardSummary;
  numberFormat: Intl.NumberFormat;
  formatDurationMs: (durationMs: number) => string;
}

export const DashboardSummaryCards: React.FC<DashboardSummaryCardsProps> = ({
  summary,
  numberFormat,
  formatDurationMs,
}) => {
  const { t } = useTranslation();

  return (
    <Grid columns={{ initial: "1", sm: "4" }} gap="4">
      <Card
        className="relative overflow-hidden"
        style={{
          backgroundColor: "var(--color-panel-solid)",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
          border: "1px solid var(--gray-a3)",
        }}
      >
        <Box className="absolute -right-6  bottom-0 flex items-center pr-4 pointer-events-none">
          <IconMicrophone size="100" className="text-logo-primary opacity-10" />
        </Box>
        <Flex direction="column" gap="3" className="relative z-10">
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

      <Card
        className="relative overflow-hidden"
        style={{
          backgroundColor: "var(--color-panel-solid)",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
          border: "1px solid var(--gray-a3)",
        }}
      >
        <Box className="absolute -right-6  bottom-0 flex items-center pr-4 pointer-events-none">
          <IconFileText size="100" className="text-blue-500 opacity-10" />
        </Box>
        <Flex direction="column" gap="3" className="relative z-10">
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

      <Card
        className="relative overflow-hidden"
        style={{
          backgroundColor: "var(--color-panel-solid)",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
          border: "1px solid var(--gray-a3)",
        }}
      >
        <Box className="absolute -right-6  bottom-0 flex items-center pr-4 pointer-events-none">
          <IconCpu size="100" className="text-purple-500 opacity-10" />
        </Box>
        <Flex direction="column" gap="3" className="relative z-10">
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

      <Card
        className="relative overflow-hidden"
        style={{
          backgroundColor: "var(--color-panel-solid)",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
          border: "1px solid var(--gray-a3)",
        }}
      >
        <Box className="absolute -right-6  bottom-0 flex items-center pr-4 pointer-events-none">
          <IconApps size="100" className="text-green-500 opacity-10" />
        </Box>
        <Flex direction="column" gap="2" className="relative z-10">
          <Text size="2" color="gray">
            {t("dashboard.summary.apps.title")}
          </Text>
          <Flex direction="column" gap="3px">
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
  );
};
