// HotwordTagCloud - Main tag cloud view for hotwords

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Badge,
  Button,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconDownload,
  IconPlus,
  IconSearch,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import React, { useCallback, useMemo, useState } from "react";
import type {
  Hotword,
  HotwordCategory,
  HotwordCategoryMeta,
  HotwordScenario,
} from "../../../types/hotword";
import { resolveIcon } from "../../../lib/hotwordIcons";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { HotwordAddBar } from "./HotwordAddBar";
import { HotwordEditPanel } from "./HotwordEditPanel";
import { HotwordTag } from "./HotwordTag";

// Droppable category group wrapper
const DroppableCategoryGroup: React.FC<{
  category: HotwordCategory;
  isDragging: boolean;
  children: React.ReactNode;
}> = ({ category, isDragging, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `category-${category}` });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border px-4 py-3 transition-colors duration-150 ${
        isOver
          ? "border-blue-400 bg-blue-50/50"
          : isDragging
            ? "border-dashed border-gray-300 bg-white/40"
            : "border-gray-200 bg-white/60"
      }`}
    >
      {children}
    </div>
  );
};

interface HotwordTagCloudProps {
  hotwords: Hotword[];
  suggestions: Hotword[];
  loading: boolean;
  onAddHotword: (
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => Promise<void>;
  onBatchAdd: (targets: string[]) => Promise<void>;
  onDelete: (id: number) => void;
  onUpdateCategory: (id: number, category: HotwordCategory) => void;
  onReload: () => void;
  onAcceptSuggestion: (id: number) => void;
  onDismissSuggestion: (id: number) => void;
  onAcceptAll: () => void;
  onDismissAll: () => void;
  onImport: () => void;
  onExport: () => void;
  categoryMap: Record<string, HotwordCategoryMeta>;
  sortedIds: string[];
  categories: HotwordCategoryMeta[];
  onAddCategory: (
    id: string,
    label: string,
    color: string,
    icon: string,
  ) => Promise<HotwordCategoryMeta>;
  onUpdateCategoryMeta: (
    id: string,
    updates: { label?: string; color?: string; icon?: string },
  ) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
}

export const HotwordTagCloud: React.FC<HotwordTagCloudProps> = ({
  hotwords,
  suggestions,
  loading,
  onAddHotword,
  onBatchAdd,
  onDelete,
  onUpdateCategory,
  onReload,
  onAcceptSuggestion,
  onDismissSuggestion,
  onAcceptAll,
  onDismissAll,
  onImport,
  onExport,
  categoryMap,
  sortedIds,
  categories,
  onAddCategory,
  onUpdateCategoryMeta,
  onDeleteCategory,
}) => {
  const [search, setSearch] = useState("");
  const [showAddBar, setShowAddBar] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // Filter hotwords by search
  const filteredHotwords = useMemo(() => {
    if (!search.trim()) return hotwords;
    const q = search.toLowerCase();
    return hotwords.filter(
      (h) =>
        h.target.toLowerCase().includes(q) ||
        h.originals.some((o) => o.toLowerCase().includes(q)),
    );
  }, [hotwords, search]);

  // Group by category, sorted: non-CJK first (alpha), then CJK by pinyin
  const grouped = useMemo(() => {
    const cjkRegex = /^[\u4e00-\u9fff\u3400-\u4dbf]/;
    const collator = new Intl.Collator("zh-Hans-CN", { sensitivity: "base" });
    const groups: Record<string, Hotword[]> = {};
    for (const id of sortedIds) {
      groups[id] = [];
    }
    filteredHotwords.forEach((h) => {
      if (!groups[h.category]) {
        groups[h.category] = [];
      }
      groups[h.category].push(h);
    });
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => {
        const aCJK = cjkRegex.test(a.target);
        const bCJK = cjkRegex.test(b.target);
        if (aCJK !== bCJK) return aCJK ? 1 : -1;
        return collator.compare(a.target, b.target);
      });
    }
    return groups;
  }, [filteredHotwords, sortedIds]);

  const selectedHotword = selectedId
    ? hotwords.find((h) => h.id === selectedId) || null
    : null;

  const handleTagClick = (id: number) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const handleDelete = (id: number) => {
    setSelectedId(null);
    onDelete(id);
  };

  const handleAddDone = async (
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => {
    await onAddHotword(target, originals, category, scenarios);
    setShowAddBar(false);
  };

  const handleBatchAddDone = async (targets: string[]) => {
    await onBatchAdd(targets);
    setShowAddBar(false);
  };

  // All category ids for drag validation (sorted + any extra from hotwords)
  const allCategoryIds = useMemo(() => {
    const ids = new Set(sortedIds);
    for (const h of hotwords) {
      ids.add(h.category);
    }
    return [...ids];
  }, [sortedIds, hotwords]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setIsDragging(false);
      const { active, over } = event;
      if (!over) return;

      const hotword = (active.data.current as { hotword: Hotword })?.hotword;
      if (!hotword) return;

      // Extract category from droppable id "category-xxx"
      const targetCategory = String(over.id).replace("category-", "");
      if (!allCategoryIds.includes(targetCategory)) return;
      if (hotword.category === targetCategory) return;

      onUpdateCategory(hotword.id, targetCategory);

      // Highlight the moved tag briefly
      setHighlightedId(hotword.id);
      setTimeout(() => setHighlightedId(null), 1200);
    },
    [onUpdateCategory, allCategoryIds],
  );

  return (
    <Flex direction="column" className="h-full">
      {/* Toolbar */}
      <div className="p-4 pb-3 border-b border-gray-100 shrink-0 bg-white z-10">
        <Flex gap="2" align="center" justify="between">
          <Flex gap="2">
            <Button
              size="2"
              variant={showAddBar ? "solid" : "soft"}
              onClick={() => setShowAddBar(!showAddBar)}
            >
              <IconPlus size={14} />
              添加
            </Button>
            <Button size="2" variant="soft" onClick={onImport}>
              <IconUpload size={14} />
              导入
            </Button>
            <Button
              size="2"
              variant="soft"
              onClick={onExport}
              disabled={hotwords.length === 0}
            >
              <IconDownload size={14} />
              导出
            </Button>
            <CategoryManageDialog
              categories={categories}
              onAdd={onAddCategory}
              onUpdate={onUpdateCategoryMeta}
              onDelete={onDeleteCategory}
            />
          </Flex>
          <div className="relative w-48">
            <TextField.Root
              size="2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索热词..."
            >
              <TextField.Slot>
                <IconSearch size={14} />
              </TextField.Slot>
              {search && (
                <TextField.Slot>
                  <IconButton
                    size="1"
                    variant="ghost"
                    onClick={() => setSearch("")}
                  >
                    <IconX size={12} />
                  </IconButton>
                </TextField.Slot>
              )}
            </TextField.Root>
          </div>
        </Flex>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 p-4 bg-gray-50/50 overflow-auto">
        <Flex direction="column" gap="3">
          {/* Add Bar */}
          {showAddBar && (
            <HotwordAddBar
              onAdd={handleAddDone}
              onBatchAdd={handleBatchAddDone}
              categoryMap={categoryMap}
            />
          )}

          {/* AI Suggestions */}
          {suggestions.length > 0 && (
            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50">
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="1" weight="bold" className="text-amber-900">
                    AI 建议 ({suggestions.length})
                  </Text>
                  <Flex gap="1">
                    <Button
                      size="1"
                      variant="soft"
                      color="green"
                      onClick={onAcceptAll}
                    >
                      全部采纳
                    </Button>
                    <Button
                      size="1"
                      variant="soft"
                      color="gray"
                      onClick={onDismissAll}
                    >
                      全部清除
                    </Button>
                  </Flex>
                </Flex>
                <Flex wrap="wrap" gap="1">
                  {suggestions.map((s) => {
                    const suggColor = (categoryMap[s.category]?.color ??
                      "gray") as
                      | "green"
                      | "orange"
                      | "blue"
                      | "purple"
                      | "gray";
                    return (
                      <Badge
                        key={s.id}
                        size="2"
                        variant="outline"
                        color={suggColor}
                        className="px-2 py-1 cursor-pointer hover:brightness-95 transition-[filter,opacity] duration-150 group"
                      >
                        <span onClick={() => onAcceptSuggestion(s.id)}>
                          {s.target}
                        </span>
                        <IconX
                          size={12}
                          className="ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 transition-opacity cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismissSuggestion(s.id);
                          }}
                        />
                      </Badge>
                    );
                  })}
                </Flex>
              </Flex>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <Text size="2" color="gray" className="py-8 text-center">
              加载中...
            </Text>
          )}

          {/* Empty state */}
          {!loading && hotwords.length === 0 && (
            <Text size="2" color="gray" className="py-8 text-center">
              暂无热词，点击"添加"按钮添加新热词
            </Text>
          )}

          {/* Search empty */}
          {!loading && hotwords.length > 0 && filteredHotwords.length === 0 && (
            <Text size="2" color="gray" className="py-4 text-center">
              未找到匹配「{search}」的热词
            </Text>
          )}

          {/* Category Groups with DnD */}
          {!loading && (
            <DndContext
              sensors={sensors}
              onDragStart={() => setIsDragging(true)}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setIsDragging(false)}
            >
              <Flex direction="column" gap="3">
                {sortedIds.map((cat) => {
                  const items = grouped[cat] || [];
                  if (items.length === 0 && !isDragging) return null;

                  const meta = categoryMap[cat];
                  const CatIcon = resolveIcon(meta?.icon);
                  const catLabel = meta?.label ?? cat;

                  return (
                    <DroppableCategoryGroup
                      key={cat}
                      category={cat}
                      isDragging={isDragging}
                    >
                      <Flex align="center" gap="1" className="mb-3">
                        {React.createElement(CatIcon, {
                          size: 14,
                          className: "text-gray-400",
                        })}
                        <Text size="1" weight="medium" color="gray">
                          {catLabel} ({items.length})
                        </Text>
                      </Flex>
                      <Flex wrap="wrap" gap="2">
                        {items.map((h) => (
                          <HotwordTag
                            key={h.id}
                            hotword={h}
                            isSelected={selectedId === h.id}
                            isHighlighted={highlightedId === h.id}
                            onClick={() => handleTagClick(h.id)}
                            categoryMap={categoryMap}
                          />
                        ))}
                        {items.length === 0 && isDragging && (
                          <Text
                            size="1"
                            color="gray"
                            className="py-2 opacity-50"
                          >
                            拖放到此分类
                          </Text>
                        )}
                      </Flex>
                      {selectedHotword && selectedHotword.category === cat && (
                        <HotwordEditPanel
                          hotword={selectedHotword}
                          onUpdate={onReload}
                          onDelete={handleDelete}
                          categoryMap={categoryMap}
                          sortedIds={sortedIds}
                        />
                      )}
                    </DroppableCategoryGroup>
                  );
                })}
              </Flex>
            </DndContext>
          )}
        </Flex>
      </div>
    </Flex>
  );
};
