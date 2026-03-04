import {
  AlertDialog,
  Badge,
  Box,
  Button,
  DropdownMenu,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { IconSettings, IconSparkles, IconTrash } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../../ui/Dropdown";
import {
  parseAiAnalysis,
  type Summary,
  type UserProfile,
} from "./summaryTypes";

interface AiAnalysisSectionProps {
  summary: Summary | null;
  userProfile: UserProfile | null;
  generating: boolean;
  generateAiAnalysis: (
    summaryId: number,
    modelId: string | null,
    splitRequests: boolean,
    parallelRequests: boolean,
  ) => Promise<void>;
  deleteSummaryHistoryEntry: (
    summaryId: number,
    timestamp: number,
  ) => Promise<void>;
  modelOptions: {
    value: string;
    label: React.ReactNode;
    searchValue: string;
  }[];
  selectedModel: string;
  onModelChange: (val: string) => void;
}

export const AiAnalysisSection: React.FC<AiAnalysisSectionProps> = ({
  summary,
  userProfile,
  generating,
  generateAiAnalysis,
  deleteSummaryHistoryEntry,
  modelOptions,
  selectedModel,
  onModelChange,
}) => {
  const { t } = useTranslation();
  const [selectedHistoryTimestamp, setSelectedHistoryTimestamp] = useState<
    number | null
  >(null);
  const [lineBreakEnabled, setLineBreakEnabled] = useState(true);
  const [splitRequestsEnabled, setSplitRequestsEnabled] = useState(false);
  const [parallelRequestsEnabled, setParallelRequestsEnabled] = useState(false);

  // Reset history selection when summary changes
  useEffect(() => {
    setSelectedHistoryTimestamp(null);
  }, [summary]);

  const handleGenerateAnalysis = () => {
    if (!summary) return;
    generateAiAnalysis(
      summary.id,
      selectedModel || null,
      splitRequestsEnabled,
      parallelRequestsEnabled,
    );
  };

  const currentDisplayTimestamp =
    selectedHistoryTimestamp ||
    (summary?.ai_history && summary.ai_history.length > 0
      ? summary.ai_history[summary.ai_history.length - 1].timestamp
      : summary?.ai_generated_at || null);

  const getDisplayContent = () => {
    let content: string | null = null;
    if (selectedHistoryTimestamp && summary?.ai_history) {
      const entry = summary.ai_history.find(
        (e) => e.timestamp === selectedHistoryTimestamp,
      );
      if (entry) {
        content = entry.summary;
      }
    } else {
      content = summary?.ai_summary ?? null;
    }

    return content;
  };

  const contentClass = lineBreakEnabled
    ? "whitespace-pre-wrap leading-relaxed"
    : "whitespace-normal leading-relaxed";

  const cardBase =
    "relative overflow-hidden rounded-2xl border p-5 shadow-sm transition-all hover:shadow-md";

  const analysis = parseAiAnalysis(getDisplayContent());

  const deleteButtonRenderedRef = useRef(false);
  // Reset on each render so the first call per render cycle wins
  deleteButtonRenderedRef.current = false;

  const renderDeleteAction = () => {
    if (deleteButtonRenderedRef.current) return null;
    const canDelete =
      (summary && currentDisplayTimestamp) || (summary && summary.ai_summary);
    if (!canDelete) return null;

    deleteButtonRenderedRef.current = true;
    const timestampToDelete = currentDisplayTimestamp || 0;

    return (
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            className="opacity-50 hover:opacity-100"
          >
            <IconTrash size={16} />
          </IconButton>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description size="2">
            您确定要删除这条 AI 分析记录吗？此操作无法撤销。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                onClick={() => {
                  deleteSummaryHistoryEntry(summary.id, timestampToDelete);
                  setSelectedHistoryTimestamp(null);
                }}
              >
                删除
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    );
  };

  return (
    <Flex direction="column" gap="5" mt="6">
      <Box className="rounded-3xl border border-(--gray-4) bg-(--gray-1) p-5 shadow-sm">
        <Flex direction="column" gap="5">
          {/* Header Section */}
          <Flex
            justify="between"
            align="center"
            className="w-full border-b border-(--gray-4) pb-4"
          >
            <Flex align="center" gap="4">
              <Flex align="center" gap="3">
                <Flex
                  justify="center"
                  align="center"
                  className="h-10 w-10 rounded-full bg-(--accent-a3) text-(--accent-11)"
                >
                  <IconSparkles size={20} />
                </Flex>
                <Text
                  size="3"
                  weight="bold"
                  className="tracking-tight text-(--gray-12)"
                >
                  {t("summary.aiAnalysis.title")}
                </Text>
              </Flex>

              {/* History Segmented Control */}
              {summary?.ai_history && summary.ai_history.length > 0 && (
                <SegmentedControl.Root
                  size="2"
                  value={String(currentDisplayTimestamp)}
                  onValueChange={(val) => {
                    const ts = Number(val);
                    setSelectedHistoryTimestamp(ts);
                  }}
                >
                  {summary.ai_history.map((entry) => (
                    <SegmentedControl.Item
                      key={entry.timestamp}
                      value={String(entry.timestamp)}
                    >
                      <Tooltip
                        content={
                          <Text size="1">
                            {entry.model || t("summary.aiAnalysis.modelUsed")}
                          </Text>
                        }
                        delayDuration={200}
                      >
                        <Box as="span" px="2">
                          {new Date(entry.timestamp * 1000).toLocaleTimeString(
                            undefined,
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </Box>
                      </Tooltip>
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
              )}
            </Flex>

            {/* Actions */}
            <Flex align="center" gap="2" className="flex-row">
              {modelOptions.length > 0 && (
                <Dropdown
                  options={modelOptions}
                  selectedValue={selectedModel}
                  onSelect={onModelChange}
                  className="w-[160px]"
                  placeholder={t("summary.aiAnalysis.selectModel")}
                  disabled={generating}
                  enableFilter={true}
                  style={{ height: "32px" }}
                />
              )}

              {/* Mode Indicator */}
              <Badge
                size="2"
                variant="soft"
                color={splitRequestsEnabled ? "blue" : "purple"}
              >
                {splitRequestsEnabled ? "拆分模式" : "一次性模式"}
                {splitRequestsEnabled && parallelRequestsEnabled && " (并发)"}
              </Badge>

              <Button
                variant="soft"
                disabled={generating || !summary}
                onClick={handleGenerateAnalysis}
                loading={generating}
                size="2"
              >
                {generating
                  ? t("summary.aiAnalysis.generating")
                  : t("summary.aiAnalysis.generate")}
              </Button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <IconButton variant="ghost" color="gray" size="2">
                    <IconSettings size={18} />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  {/* ... Menu Items ... */}
                  <DropdownMenu.Item
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Flex
                      align="center"
                      justify="between"
                      className="w-[200px]"
                    >
                      <Text size="2">换行</Text>
                      <Switch
                        checked={lineBreakEnabled}
                        onCheckedChange={setLineBreakEnabled}
                        size="1"
                      />
                    </Flex>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Flex
                      align="center"
                      justify="between"
                      className="w-[200px]"
                    >
                      <Text size="2">拆分请求</Text>
                      <Switch
                        checked={splitRequestsEnabled}
                        onCheckedChange={setSplitRequestsEnabled}
                        size="1"
                      />
                    </Flex>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Flex
                      align="center"
                      justify="between"
                      className="w-[200px]"
                    >
                      <Text size="2">并发请求</Text>
                      <Switch
                        checked={parallelRequestsEnabled}
                        onCheckedChange={setParallelRequestsEnabled}
                        disabled={!splitRequestsEnabled}
                        size="1"
                      />
                    </Flex>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Flex>
          </Flex>

          {/* Analysis Results */}
          {analysis ? (
            <Grid columns={{ initial: "1", md: "2" }} gap="5">
              {/* Activity Summary - Full Width */}
              {analysis.summary && (
                <Box
                  className={`${cardBase} md:col-span-2 bg-linear-to-br from-(--gray-1) to-(--gray-2) border-(--gray-3)`}
                >
                  <Flex justify="between" align="start" mb="3">
                    <Text
                      size="3"
                      weight="bold"
                      className="block text-(--gray-12)"
                    >
                      {analysis.summary.title}
                    </Text>
                    {renderDeleteAction()}
                  </Flex>
                  {analysis.summary.content && (
                    <Text size="2" color="gray" className={contentClass}>
                      {analysis.summary.content}
                    </Text>
                  )}
                </Box>
              )}

              {/* Specific Activities */}
              {analysis.activities?.items &&
                analysis.activities.items.length > 0 && (
                  <Box
                    className={`${cardBase} bg-linear-to-br from-(--gray-1) to-(--gray-2) border-(--gray-3)`}
                  >
                    <Flex justify="between" align="start" mb="3">
                      <Text
                        size="2"
                        weight="bold"
                        className="block text-(--gray-11)"
                      >
                        {analysis.activities.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <ul className="list-disc list-inside space-y-2">
                      {analysis.activities.items.map((item, i) => (
                        <li key={i} className="pl-1">
                          <Text size="2" color="gray" className={contentClass}>
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
                  <Box
                    className={`${cardBase} bg-linear-to-br from-(--accent-a1) to-(--accent-a2) border-(--accent-a3)`}
                  >
                    <Flex justify="between" align="start" mb="3">
                      <Text
                        size="2"
                        weight="bold"
                        className="block text-(--accent-11)"
                      >
                        {analysis.highlights.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <ul className="list-disc list-inside space-y-2">
                      {analysis.highlights.items.map((item, i) => (
                        <li key={i} className="pl-1">
                          <Text size="2" color="gray" className={contentClass}>
                            {item}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </Box>
                )}

              {/* Extended Fields: Work Focus, Communication, Insights */}
              {analysis.work_focus?.items &&
                analysis.work_focus.items.length > 0 && (
                  <Box
                    className={`${cardBase} bg-linear-to-br from-(--blue-a1) to-(--blue-a2) border-(--blue-a3)`}
                  >
                    <Flex justify="between" align="start" mb="3">
                      <Text
                        size="2"
                        weight="bold"
                        className="block text-(--blue-11)"
                      >
                        {analysis.work_focus.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <ul className="list-disc list-inside space-y-2">
                      {analysis.work_focus.items.map((item, i) => (
                        <li key={i} className="pl-1">
                          <Text size="2" color="gray" className={contentClass}>
                            {item}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </Box>
                )}

              {analysis.insights?.items &&
                analysis.insights.items.length > 0 && (
                  <Box
                    className={`${cardBase} bg-linear-to-br from-(--green-a1) to-(--green-a2) border-(--green-a3)`}
                  >
                    <Flex justify="between" align="start" mb="3">
                      <Text
                        size="2"
                        weight="bold"
                        className="block text-(--green-11)"
                      >
                        {analysis.insights.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <ul className="list-disc list-inside space-y-2">
                      {analysis.insights.items.map((item, i) => (
                        <li key={i} className="pl-1">
                          <Text size="2" color="gray" className={contentClass}>
                            {item}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </Box>
                )}

              {/* Focus Assessment */}
              {analysis.focus_assessment && (
                <Box
                  className={`${cardBase} md:col-span-2 bg-linear-to-br from-(--cyan-a1) to-(--cyan-a2) border-(--cyan-a3)`}
                >
                  <Flex justify="between" align="center" mb="3">
                    <Flex align="center" gap="2">
                      <Text size="2" weight="bold" className="text-(--cyan-11)">
                        {analysis.focus_assessment.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <Badge size="2" variant="solid" color="cyan" radius="full">
                      {analysis.focus_assessment.score} / 10
                    </Badge>
                  </Flex>
                  <Text size="2" color="gray" className={contentClass}>
                    {analysis.focus_assessment.comment}
                  </Text>
                </Box>
              )}

              {/* Week/Month Specifics */}
              {analysis.patterns?.items &&
                analysis.patterns.items.length > 0 && (
                  <Box
                    className={`${cardBase} bg-linear-to-br from-(--violet-a1) to-(--violet-a2) border-(--violet-a3)`}
                  >
                    <Flex justify="between" align="start" mb="3">
                      <Text
                        size="2"
                        weight="bold"
                        className="block text-(--violet-11)"
                      >
                        {analysis.patterns.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <ul className="list-disc list-inside space-y-2">
                      {analysis.patterns.items.map((item, i) => (
                        <li key={i} className="pl-1">
                          <Text size="2" color="gray" className={contentClass}>
                            {item}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </Box>
                )}

              {analysis.next_week?.items &&
                analysis.next_week.items.length > 0 && (
                  <Box
                    className={`${cardBase} bg-linear-to-br from-(--amber-a1) to-(--amber-a2) border-(--amber-a3)`}
                  >
                    <Flex justify="between" align="start" mb="3">
                      <Text
                        size="2"
                        weight="bold"
                        className="block text-(--amber-11)"
                      >
                        {analysis.next_week.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <ul className="list-disc list-inside space-y-2">
                      {analysis.next_week.items.map((item, i) => (
                        <li key={i} className="pl-1">
                          <Text size="2" color="gray" className={contentClass}>
                            {item}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </Box>
                )}
              {analysis.trends?.items && analysis.trends.items.length > 0 && (
                <Box
                  className={`${cardBase} md:col-span-2 bg-linear-to-br from-(--teal-a1) to-(--teal-a2) border-(--teal-a3)`}
                >
                  <Flex justify="between" align="start" mb="3">
                    <Text
                      size="2"
                      weight="bold"
                      className="block text-(--teal-11)"
                    >
                      {analysis.trends.title}
                    </Text>
                    {renderDeleteAction()}
                  </Flex>
                  <ul className="list-disc list-inside space-y-2">
                    {analysis.trends.items.map((item, i) => (
                      <li key={i} className="pl-1">
                        <Text size="2" color="gray" className={contentClass}>
                          {item}
                        </Text>
                      </li>
                    ))}
                  </ul>
                </Box>
              )}

              {/* Vocabulary Extracted - Moved to the end */}
              {analysis.vocabulary_extracted?.items &&
                analysis.vocabulary_extracted.items.length > 0 && (
                  <Box
                    className={`${cardBase} md:col-span-2 bg-linear-to-br from-(--purple-a1) to-(--purple-a2) border-(--purple-a3)`}
                  >
                    <Flex justify="between" align="start" mb="3">
                      <Text
                        size="2"
                        weight="bold"
                        className="block text-(--purple-11)"
                      >
                        {analysis.vocabulary_extracted.title}
                      </Text>
                      {renderDeleteAction()}
                    </Flex>
                    <Flex wrap="wrap" gap="2">
                      {analysis.vocabulary_extracted.items.map((item, i) => {
                        // Extract word and type from "Word (类型)" format
                        const match = item.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
                        const word = match ? match[1].trim() : item;
                        const typeHint = match ? match[2].trim() : null;

                        // Map type hint to color
                        const getTypeColor = (
                          hint: string | null,
                        ): "purple" | "blue" | "green" | "orange" | "gray" => {
                          if (!hint) return "purple";
                          if (
                            hint.includes("项目") ||
                            hint.includes("模块") ||
                            hint.includes("工作")
                          )
                            return "blue";
                          if (hint.includes("人名") || hint.includes("同事"))
                            return "green";
                          if (hint.includes("技术") || hint.includes("术语"))
                            return "orange";
                          return "purple";
                        };

                        return (
                          <Flex key={i} gap="1" align="center">
                            <Badge
                              size="2"
                              variant="soft"
                              color={getTypeColor(typeHint)}
                              className="px-3 py-1"
                            >
                              {word}
                            </Badge>
                            {typeHint && (
                              <Text
                                size="1"
                                color="gray"
                                className="opacity-60"
                              >
                                {typeHint}
                              </Text>
                            )}
                          </Flex>
                        );
                      })}
                    </Flex>
                  </Box>
                )}
            </Grid>
          ) : summary?.ai_summary ? (
            <Box
              className={`${cardBase} bg-linear-to-br from-(--gray-1) to-(--gray-2) border-(--gray-3)`}
            >
              <Flex justify="between" align="start" mb="3">
                <Text size="2" weight="bold">
                  AI 分析
                </Text>
                {renderDeleteAction()}
              </Flex>
              <Text size="2" color="gray" className={contentClass}>
                {summary.ai_summary}
              </Text>
            </Box>
          ) : (
            <Box className="rounded-xl border border-(--gray-3) border-dashed bg-linear-to-br from-(--gray-1) to-(--gray-2) p-10 text-center shadow-sm">
              <IconSparkles
                size={32}
                className="mx-auto mb-3 text-(--gray-8) opacity-50"
                stroke={1.5}
              />
              <Text size="2" color="gray">
                {t("summary.aiAnalysis.empty")}
              </Text>
            </Box>
          )}
        </Flex>
      </Box>

      {/* User Profile Quick View */}
      {userProfile?.style_prompt && (
        <Box className="rounded-xl border border-(--accent-a4) bg-linear-to-br from-(--accent-a2) to-(--accent-a3) p-5 shadow-sm">
          <Flex gap="3" align="start">
            <Box className="mt-1">
              <IconSettings size={18} className="text-(--accent-11)" />
            </Box>
            <Box>
              <Text
                size="2"
                weight="bold"
                mb="1"
                className="block text-(--accent-11)"
              >
                {t("summary.userProfile.currentStyle")}
              </Text>
              <Text size="2" className="italic text-(--gray-12) opacity-80">
                {userProfile.style_prompt}
              </Text>
            </Box>
          </Flex>
        </Box>
      )}
    </Flex>
  );
};
