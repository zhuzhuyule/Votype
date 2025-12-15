import { Card, Flex, Grid, Heading, Text } from "@radix-ui/themes";
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
      <Card>
        <Flex direction="column" gap="3">
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

      <Card>
        <Flex direction="column" gap="3">
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

      <Card>
        <Flex direction="column" gap="3">
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

      <Card>
        <Flex direction="column" gap="3">
          <Text size="2" color="gray">
            {t("dashboard.summary.apps.title")}
          </Text>
          <Flex direction="column" gap="1">
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
