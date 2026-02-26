// VocabularyBufferSettings - Manage AI-extracted vocabulary with review and promotion

import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  SegmentedControl,
  Table,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconInfoCircle,
  IconPrompt,
  IconSearch,
  IconSparkles,
  IconThumbDown,
  IconThumbUp,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useVocabularyBuffer } from "../../hooks/useVocabularyBuffer";
import type { VocabularyBufferItem } from "../../types/vocabularyBuffer";
import { Card } from "../ui/Card";
import { useTranslation } from "react-i18next";

type FilterType = "all" | "pending" | "approved" | "high_confidence" | "typos";

const CATEGORY_ICONS: Record<string, string> = {
  Term: "📚",
  Person: "👤",
  Brand: "🏷️",
  Abbreviation: "🔤",
  Project: "📁",
};

const FREQUENCY_LABELS: Record<string, string> = {
  rare: "罕见",
  common: "常见",
  high: "高频",
};

export function VocabularyBufferSettings() {
  const { t } = useTranslation();
  const {
    items,
    stats,
    isLoading,
    updateDecision,
    promote,
    delete: deleteItem,
    autoPromote,
    isUpdating,
    isAutoPromoting,
  } = useVocabularyBuffer();

  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteDialogItem, setDeleteDialogItem] =
    useState<VocabularyBufferItem | null>(null);
  const [autoPromoteDialogOpen, setAutoPromoteDialogOpen] = useState(false);

  // Filter items
  const filteredItems = useMemo(() => {
    let result = items;

    // Apply category filter
    if (filter === "pending") {
      result = result.filter(
        (item) => !item.user_decision && !item.promoted_at,
      );
    } else if (filter === "approved") {
      result = result.filter((item) => item.user_decision === "approve");
    } else if (filter === "high_confidence") {
      result = result.filter((item) => item.confidence >= 80);
    } else if (filter === "typos") {
      result = result.filter((item) => item.possible_typo);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) => item.word.toLowerCase().includes(query));
    }

    return result;
  }, [items, filter, searchQuery]);

  const handleApprove = async (id: number) => {
    const success = await updateDecision({ id, decision: "approve" });
    if (success) {
      toast.success("已标记为通过");
    }
  };

  const handleReject = async (id: number) => {
    const success = await updateDecision({ id, decision: "reject" });
    if (success) {
      toast.success("已标记为拒绝");
    }
  };

  const handlePromote = async (item: VocabularyBufferItem) => {
    const success = await promote(item.id);
    if (success) {
      toast.success(`"${item.word}" 已提升至热词库`);
    }
  };

  const handleDelete = (item: VocabularyBufferItem) => {
    setDeleteDialogItem(item);
  };

  const confirmDelete = async () => {
    if (deleteDialogItem) {
      const success = await deleteItem(deleteDialogItem.id);
      if (success) {
        toast.success("已删除");
      }
      setDeleteDialogItem(null);
    }
  };

  const handleAutoPromote = async () => {
    const count = await autoPromote();
    setAutoPromoteDialogOpen(false);
    if (count > 0) {
      toast.success(`自动提升完成: ${count} 个词汇已添加到热词库`);
    }
  };

  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 80) return "green";
    if (confidence >= 60) return "yellow";
    return "gray";
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      Term: "术语",
      Person: "人名",
      Brand: "品牌",
      Abbreviation: "缩写",
      Project: "项目",
    };
    return labels[category] || category;
  };

  return (
    <Flex direction="column" gap="4">
      {/* Stats Card */}
      <Card>
        <Flex direction="column" gap="3">
          <Text size="5" weight="bold">
            词库统计
          </Text>
          <Flex gap="6">
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">
                总词汇数
              </Text>
              <Text size="6" weight="bold">
                {stats?.total || 0}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">
                高置信度
              </Text>
              <Text size="6" weight="bold" color="green">
                {stats?.high_confidence || 0}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">
                可能错误
              </Text>
              <Text size="6" weight="bold" color="orange">
                {stats?.typos || 0}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">
                已提升
              </Text>
              <Text size="6" weight="bold" color="blue">
                {stats?.promoted || 0}
              </Text>
            </Flex>
          </Flex>
        </Flex>
      </Card>

      {/* Controls */}
      <Card>
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <SegmentedControl.Root
              value={filter}
              onValueChange={(value) => setFilter(value as FilterType)}
            >
              <SegmentedControl.Item value="all">
                全部 ({items.length})
              </SegmentedControl.Item>
              <SegmentedControl.Item value="pending">
                待审核
              </SegmentedControl.Item>
              <SegmentedControl.Item value="high_confidence">
                高置信度
              </SegmentedControl.Item>
              <SegmentedControl.Item value="typos">
                可能错误
              </SegmentedControl.Item>
            </SegmentedControl.Root>

            <Button
              variant="solid"
              disabled={isAutoPromoting}
              onClick={() => setAutoPromoteDialogOpen(true)}
            >
              <IconSparkles size={16} />
              自动提升
            </Button>
          </Flex>

          <TextField.Root
            placeholder="搜索词汇..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          >
            <TextField.Slot>
              <IconSearch size={16} />
            </TextField.Slot>
          </TextField.Root>
        </Flex>
      </Card>

      {/* Items Table */}
      <Card>
        {isLoading ? (
          <Flex justify="center" py="9">
            <Text color="gray">加载中...</Text>
          </Flex>
        ) : filteredItems.length === 0 ? (
          <Flex justify="center" py="9">
            <Text color="gray">
              {searchQuery ? "未找到匹配的词汇" : "暂无词汇"}
            </Text>
          </Flex>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>词汇</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>分类</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>置信度</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>频次</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>上下文</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredItems.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell>
                    <Flex direction="column" gap="1">
                      <Flex align="center" gap="2">
                        <Text weight="bold">{item.word}</Text>
                        {item.possible_typo && (
                          <Tooltip content="可能的拼写错误">
                            <Badge color="orange" variant="soft">
                              可能错误
                            </Badge>
                          </Tooltip>
                        )}
                      </Flex>
                      {item.similar_suggestions &&
                        item.similar_suggestions.length > 0 && (
                          <Text size="1" color="gray">
                            建议: {item.similar_suggestions.join(", ")}
                          </Text>
                        )}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant="soft">
                      <Flex align="center" gap="1">
                        <span>{CATEGORY_ICONS[item.category] || "📝"}</span>
                        <span>{getCategoryLabel(item.category)}</span>
                      </Flex>
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      color={getConfidenceBadgeColor(item.confidence)}
                      variant="soft"
                    >
                      {item.confidence}%
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="bold">
                        {item.cumulative_count}次
                      </Text>
                      <Text size="1" color="gray">
                        {item.days_appeared}天 •{" "}
                        {FREQUENCY_LABELS[item.frequency_type] ||
                          item.frequency_type}
                      </Text>
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="1" color="gray" style={{ maxWidth: "200px" }}>
                      {item.context_sample || "-"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {item.promoted_at ? (
                      <Badge color="blue">已提升</Badge>
                    ) : item.user_decision === "approve" ? (
                      <Badge color="green">已通过</Badge>
                    ) : item.user_decision === "reject" ? (
                      <Badge color="red">已拒绝</Badge>
                    ) : (
                      <Badge color="gray">待审核</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Flex gap="1">
                      {!item.promoted_at && (
                        <>
                          {item.user_decision !== "approve" && (
                            <Tooltip content="标记为通过">
                              <IconButton
                                size="1"
                                variant="ghost"
                                color="green"
                                disabled={isUpdating}
                                onClick={() => handleApprove(item.id)}
                              >
                                <IconThumbUp size={14} />
                              </IconButton>
                            </Tooltip>
                          )}
                          {item.user_decision !== "reject" && (
                            <Tooltip content="标记为拒绝">
                              <IconButton
                                size="1"
                                variant="ghost"
                                color="red"
                                disabled={isUpdating}
                                onClick={() => handleReject(item.id)}
                              >
                                <IconThumbDown size={14} />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip content="提升至热词库">
                            <IconButton
                              size="1"
                              variant="ghost"
                              color="blue"
                              disabled={isUpdating}
                              onClick={() => handlePromote(item)}
                            >
                              <IconPrompt size={14} />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip content="删除">
                        <IconButton
                          size="1"
                          variant="ghost"
                          color="gray"
                          disabled={isUpdating}
                          onClick={() => handleDelete(item)}
                        >
                          <IconTrash size={14} />
                        </IconButton>
                      </Tooltip>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog.Root
        open={!!deleteDialogItem}
        onOpenChange={(open) => !open && setDeleteDialogItem(null)}
      >
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description>
            确定要删除词汇 "{deleteDialogItem?.word}" 吗？此操作无法撤销。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={confirmDelete}>
                删除
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      {/* Auto Promote Dialog */}
      <AlertDialog.Root
        open={autoPromoteDialogOpen}
        onOpenChange={setAutoPromoteDialogOpen}
      >
        <AlertDialog.Content maxWidth="500px">
          <AlertDialog.Title>自动提升词汇</AlertDialog.Title>
          <AlertDialog.Description>
            <Flex direction="column" gap="3">
              <Text>系统将自动提升符合以下条件的词汇到热词库：</Text>
              <Flex direction="column" gap="2" ml="4">
                <Text size="2">• 累计出现次数 ≥ 10 次</Text>
                <Text size="2">• 出现天数 ≥ 3 天</Text>
                <Text size="2">• 置信度 ≥ 80%</Text>
              </Flex>
              <Flex align="center" gap="2" mt="2">
                <IconInfoCircle size={16} />
                <Text size="2" color="gray">
                  已提升的词汇将自动在转写时注入到热词库
                </Text>
              </Flex>
            </Flex>
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
                disabled={isAutoPromoting}
                onClick={handleAutoPromote}
              >
                <IconSparkles size={16} />
                开始提升
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}
