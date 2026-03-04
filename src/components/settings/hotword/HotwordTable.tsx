// HotwordTable - Table component for displaying hotword list

import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  Flex,
  IconButton,
  SegmentedControl,
  Table,
  Text,
} from "@radix-ui/themes";
import {
  IconCategory,
  IconChevronDown,
  IconDownload,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUpload,
  IconWorld,
} from "@tabler/icons-react";
import React from "react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
  SCENARIO_LABELS,
} from "../../../types/hotword";

// Filter type includes "all" plus all categories
type FilterType = "all" | HotwordCategory;

interface HotwordTableProps {
  hotwords: Hotword[];
  loading: boolean;
  filter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onEdit: (hotword: Hotword) => void;
  onDelete: (id: number) => void;
  onBatchChangeCategory: (category: HotwordCategory) => Promise<void>;
  onBatchChangeScenarios: (scenarios: HotwordScenario[]) => Promise<void>;
  onBatchDelete: () => Promise<void>;
  onAddClick: () => void;
  onBatchAddClick: () => void;
  onImport: () => void;
  onExport: () => void;
}

export const HotwordTable: React.FC<HotwordTableProps> = ({
  hotwords,
  loading,
  filter,
  onFilterChange,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onClearSelection,
  onEdit,
  onDelete,
  onBatchChangeCategory,
  onBatchChangeScenarios,
  onBatchDelete,
  onAddClick,
  onBatchAddClick,
  onImport,
  onExport,
}) => {
  // Filter hotwords by category (with null safety)
  const filteredHotwords = React.useMemo(
    () =>
      filter === "all"
        ? hotwords.filter((h) => h != null)
        : hotwords.filter((h) => h != null && h.category === filter),
    [filter, hotwords],
  );

  // Group hotwords by category for display
  const groupedHotwords = React.useMemo(() => {
    const groups: Record<HotwordCategory, Hotword[]> = {
      person: [],
      term: [],
      brand: [],
      abbreviation: [],
    };

    filteredHotwords.forEach((h) => {
      if (h && h.category && groups[h.category]) {
        groups[h.category].push(h);
      }
    });

    return groups;
  }, [filteredHotwords]);

  // Render category group
  const renderCategoryGroup = (category: HotwordCategory, items: Hotword[]) => {
    if (items.length === 0) return null;

    return (
      <React.Fragment key={category}>
        <Table.Row>
          <Table.Cell colSpan={6} className="bg-gray-50/80">
            <Text size="2" weight="medium">
              {CATEGORY_ICONS[category]} {CATEGORY_LABELS[category]} (
              {items.length})
            </Text>
          </Table.Cell>
        </Table.Row>
        {items.map((h) => (
          <Table.Row
            key={h.id}
            className={selectedIds.has(h.id) ? "bg-blue-50" : ""}
          >
            <Table.Cell width="40px">
              <Checkbox
                checked={selectedIds.has(h.id)}
                onCheckedChange={() => onToggleSelect(h.id)}
              />
            </Table.Cell>
            <Table.Cell>
              <Text size="2" weight="bold" className="font-mono">
                {h.target}
              </Text>
            </Table.Cell>
            <Table.Cell>
              <Flex wrap="wrap" gap="1">
                {h.originals.slice(0, 3).map((orig, i) => (
                  <Badge key={i} size="1" color="gray" variant="soft">
                    {orig}
                  </Badge>
                ))}
                {h.originals.length > 3 && (
                  <Badge size="1" color="gray" variant="soft">
                    +{h.originals.length - 3}
                  </Badge>
                )}
                {h.originals.length === 0 && (
                  <Text size="1" color="gray">
                    -
                  </Text>
                )}
              </Flex>
            </Table.Cell>
            <Table.Cell>
              <Flex wrap="wrap" gap="1">
                {h.scenarios.map((s) => (
                  <Badge key={s} size="1" color="blue" variant="soft">
                    {SCENARIO_LABELS[s]}
                  </Badge>
                ))}
              </Flex>
            </Table.Cell>
            <Table.Cell align="center">
              <Badge size="1" color="gray">
                {h.use_count}
              </Badge>
            </Table.Cell>
            <Table.Cell align="right">
              <Flex gap="1">
                <IconButton variant="ghost" size="1" onClick={() => onEdit(h)}>
                  <IconPencil size={14} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="1"
                  color="red"
                  onClick={() => onDelete(h.id)}
                >
                  <IconTrash size={14} />
                </IconButton>
              </Flex>
            </Table.Cell>
          </Table.Row>
        ))}
      </React.Fragment>
    );
  };

  return (
    <Flex direction="column" className="h-full">
      {/* Fixed Header */}
      <div className="p-6 pb-4 border-b border-gray-100 shrink-0 bg-white z-10">
        <Flex direction="column" gap="4">
          {/* Filter tabs */}
          <Flex justify="center">
            <SegmentedControl.Root
              value={filter}
              onValueChange={(v) => onFilterChange(v as FilterType)}
              size="2"
            >
              <SegmentedControl.Item value="all">
                <Text size="2">全部</Text>
              </SegmentedControl.Item>
              {(
                Object.entries(CATEGORY_LABELS) as [HotwordCategory, string][]
              ).map(([key, label]) => (
                <SegmentedControl.Item key={key} value={key}>
                  <Flex gap="1" align="center">
                    <Text size="2">{CATEGORY_ICONS[key]}</Text>
                    <Text size="2">{label}</Text>
                  </Flex>
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
          </Flex>

          {/* Action buttons or batch actions */}
          {selectedIds.size > 0 ? (
            <Flex gap="2" justify="between" align="center">
              <Text size="2" color="gray">
                已选择 {selectedIds.size} 项
              </Text>
              <Flex gap="2">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <Button variant="soft">
                      <IconCategory size={14} />
                      修改类别
                      <IconChevronDown size={14} />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    {(
                      Object.entries(CATEGORY_LABELS) as [
                        HotwordCategory,
                        string,
                      ][]
                    ).map(([key, label]) => (
                      <DropdownMenu.Item
                        key={key}
                        onClick={() => onBatchChangeCategory(key)}
                      >
                        {CATEGORY_ICONS[key]} {label}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <Button variant="soft">
                      <IconWorld size={14} />
                      修改场景
                      <IconChevronDown size={14} />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item
                      onClick={() => onBatchChangeScenarios(["work"])}
                    >
                      仅工作
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onClick={() => onBatchChangeScenarios(["casual"])}
                    >
                      仅日常
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onClick={() => onBatchChangeScenarios(["work", "casual"])}
                    >
                      工作 + 日常
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                <Button variant="soft" color="red" onClick={onBatchDelete}>
                  <IconTrash size={14} />
                  删除
                </Button>
                <Button variant="ghost" onClick={onClearSelection}>
                  取消选择
                </Button>
              </Flex>
            </Flex>
          ) : (
            <Flex gap="2" justify="end">
              <Button variant="soft" onClick={onBatchAddClick}>
                <IconPlus size={14} />
                批量添加
              </Button>
              <Button onClick={onAddClick}>
                <IconPlus size={14} />
                添加
              </Button>
              <Button variant="soft" onClick={onImport}>
                <IconUpload size={14} />
                导入
              </Button>
              <Button
                variant="soft"
                onClick={onExport}
                disabled={hotwords.length === 0}
              >
                <IconDownload size={14} />
                导出
              </Button>
            </Flex>
          )}
        </Flex>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 p-6 bg-gray-50/50 overflow-auto">
        {loading ? (
          <Text size="2" color="gray" className="py-8 text-center">
            加载中...
          </Text>
        ) : filteredHotwords.length > 0 ? (
          <Table.Root variant="surface">
            <Table.Header className="sticky top-0 bg-white z-20 shadow-sm">
              <Table.Row>
                <Table.ColumnHeaderCell width="40px">
                  <Checkbox
                    checked={
                      filteredHotwords.length > 0 &&
                      selectedIds.size === filteredHotwords.length
                    }
                    onCheckedChange={onToggleSelectAll}
                  />
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell width="22%">
                  目标词
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell width="28%">
                  原始变体
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell width="18%">
                  场景
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell width="12%" align="center">
                  使用次数
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell width="10%" align="right">
                  操作
                </Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filter === "all"
                ? // Show grouped by category
                  (Object.keys(groupedHotwords) as HotwordCategory[]).map(
                    (cat) => renderCategoryGroup(cat, groupedHotwords[cat]),
                  )
                : // Show flat list for filtered category
                  filteredHotwords.map((h) => (
                    <Table.Row
                      key={h.id}
                      className={selectedIds.has(h.id) ? "bg-blue-50" : ""}
                    >
                      <Table.Cell width="40px">
                        <Checkbox
                          checked={selectedIds.has(h.id)}
                          onCheckedChange={() => onToggleSelect(h.id)}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="2" weight="bold" className="font-mono">
                          {h.target}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Flex wrap="wrap" gap="1">
                          {h.originals.slice(0, 3).map((orig, i) => (
                            <Badge key={i} size="1" color="gray" variant="soft">
                              {orig}
                            </Badge>
                          ))}
                          {h.originals.length > 3 && (
                            <Badge size="1" color="gray" variant="soft">
                              +{h.originals.length - 3}
                            </Badge>
                          )}
                          {h.originals.length === 0 && (
                            <Text size="1" color="gray">
                              -
                            </Text>
                          )}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Flex wrap="wrap" gap="1">
                          {h.scenarios.map((s) => (
                            <Badge key={s} size="1" color="blue" variant="soft">
                              {SCENARIO_LABELS[s]}
                            </Badge>
                          ))}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell align="center">
                        <Badge size="1" color="gray">
                          {h.use_count}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell align="right">
                        <Flex gap="1">
                          <IconButton
                            variant="ghost"
                            size="1"
                            onClick={() => onEdit(h)}
                          >
                            <IconPencil size={14} />
                          </IconButton>
                          <IconButton
                            variant="ghost"
                            size="1"
                            color="red"
                            onClick={() => onDelete(h.id)}
                          >
                            <IconTrash size={14} />
                          </IconButton>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                  ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Text size="2" color="gray" className="py-8 text-center">
            暂无热词，点击"添加"按钮添加新热词
          </Text>
        )}
      </div>
    </Flex>
  );
};
