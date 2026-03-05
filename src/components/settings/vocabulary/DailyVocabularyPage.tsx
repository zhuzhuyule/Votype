import { invoke } from "@tauri-apps/api/core";
import {
  Badge,
  Box,
  Button,
  Card,
  Dialog,
  DropdownMenu,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  DndContext,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type DragCancelEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";
import {
  PlusIcon,
  TrashIcon,
  ArrowUpIcon,
  DragHandleDots2Icon,
} from "@radix-ui/react-icons";
import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CONTEXT_TYPES, type DailyVocabularyItem } from "./vocabularyTypes";

const getItemId = (item: DailyVocabularyItem) => `item-${item.id}`;
const fallbackColors = ["blue", "green", "orange", "purple"] as const;

const getTypeColor = (
  type: string,
): "blue" | "green" | "orange" | "purple" | "gray" => {
  switch (type) {
    case "work":
      return "blue";
    case "people":
      return "green";
    case "learning":
      return "orange";
    case "life":
      return "purple";
    case "entertainment":
      return "orange";
    case "location":
      return "green";
    case "other":
      return "gray";
    default: {
      const hash = Array.from(type).reduce(
        (acc, char) => acc + char.charCodeAt(0),
        0,
      );
      return fallbackColors[hash % fallbackColors.length] ?? "gray";
    }
  }
};

type FilterMode = "inbox" | "high" | "recent";

type GroupDef = {
  value: string;
  label: string;
  isCustom?: boolean;
};

const CUSTOM_GROUPS_STORAGE_KEY = "votype_daily_vocabulary_groups";

const loadCustomGroups = (): GroupDef[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_GROUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.value === "string" &&
        typeof item.label === "string",
    );
  } catch {
    return [];
  }
};

const SortableWord: React.FC<{
  item: DailyVocabularyItem;
  color: "blue" | "green" | "orange" | "purple" | "gray";
  onPromote: (word: string, contextType: string | null) => void;
  onRemove: (word: string) => void;
  onMoveTo: (word: string, contextType: string) => void;
  type: string;
  availableGroups: GroupDef[];
}> = ({
  item,
  color,
  onPromote,
  onRemove,
  onMoveTo,
  type,
  availableGroups,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getItemId(item) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.2 : 1,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 4px",
        borderRadius: "999px",
        backgroundColor: isDragging ? "var(--gray-a2)" : "transparent",
        userSelect: "none",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "2px 6px",
          borderRadius: "6px",
          color: "var(--gray-9)",
          backgroundColor: isDragging ? "var(--gray-a3)" : "transparent",
          transition: "background-color 120ms ease",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        {...attributes}
        {...listeners}
      >
        <DragHandleDots2Icon width="16" height="16" />
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <div
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Badge
              size="2"
              variant="soft"
              color={color}
              style={{
                cursor: "pointer",
                paddingLeft: "8px",
                paddingRight: "8px",
                pointerEvents: "auto",
              }}
            >
              <span
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
              >
                <span style={{ fontSize: "14px", fontWeight: 500 }}>
                  {item.word}
                </span>
                <span style={{ fontSize: "12px", opacity: 0.6 }}>
                  ×{item.frequency}
                </span>
              </span>
            </Badge>
          </div>
        </DropdownMenu.Trigger>

        <DropdownMenu.Content>
          <DropdownMenu.Label>移动到</DropdownMenu.Label>
          {availableGroups
            .filter((group) => group.value !== type)
            .map((targetGroup) => (
              <DropdownMenu.Item
                key={targetGroup.value}
                onClick={() => onMoveTo(item.word, targetGroup.value)}
              >
                {targetGroup.label}
              </DropdownMenu.Item>
            ))}
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            color="green"
            onClick={() => onPromote(item.word, item.context_type)}
          >
            <ArrowUpIcon /> 晋升为热词
          </DropdownMenu.Item>
          <DropdownMenu.Item color="red" onClick={() => onRemove(item.word)}>
            <TrashIcon /> 删除
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
};

const DroppableContainer: React.FC<{
  id: string;
  isEmpty: boolean;
  children: React.ReactNode;
  placeholder?: string;
  minHeight?: string;
}> = ({ id, isEmpty, children, placeholder, minHeight = "60px" }) => {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight,
        padding: "0.5rem",
        backgroundColor: isOver ? "var(--accent-a3)" : "var(--gray-a2)",
        borderRadius: "8px",
        border: `1px dashed ${isOver ? "var(--accent-9)" : "var(--gray-4)"}`,
        boxShadow: isOver ? "0 0 0 2px var(--accent-a4)" : "none",
        transition: "all 120ms ease",
      }}
    >
      {isEmpty ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight,
          }}
        >
          <Text size="1" color="gray">
            {placeholder || "拖拽词汇到此处"}
          </Text>
        </div>
      ) : (
        children
      )}
    </div>
  );
};

export function DailyVocabularyPage() {
  const [vocabularyItems, setVocabularyItems] = useState<DailyVocabularyItem[]>(
    [],
  );
  const [newWord, setNewWord] = useState("");
  const [newWordType, setNewWordType] = useState<string>("other");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("inbox");
  const [customGroups, setCustomGroups] = useState<GroupDef[]>(() =>
    loadCustomGroups(),
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [addWordOpen, setAddWordOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeRect, setActiveRect] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [dragPointer, setDragPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragStartPointer, setDragStartPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  useEffect(() => {
    loadVocabulary();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CUSTOM_GROUPS_STORAGE_KEY,
      JSON.stringify(customGroups),
    );
  }, [customGroups]);

  const loadVocabulary = async () => {
    setLoading(true);
    try {
      const items = await invoke<DailyVocabularyItem[]>(
        "get_all_daily_vocabulary",
      );
      setVocabularyItems(items);
    } catch (error) {
      console.error("Failed to load vocabulary:", error);
      toast.error("加载词汇失败");
    } finally {
      setLoading(false);
    }
  };

  const handleAddWord = async (): Promise<boolean> => {
    if (!newWord.trim()) {
      toast.error("请输入词汇");
      return false;
    }

    try {
      const today = new Date().toISOString().split("T")[0];
      await invoke("add_word_to_daily_vocabulary", {
        date: today,
        word: newWord.trim(),
        contextType: newWordType,
      });
      toast.success("添加成功");
      setNewWord("");
      loadVocabulary();
      return true;
    } catch (error) {
      console.error("Failed to add word:", error);
      toast.error("添加失败");
      return false;
    }
  };

  const handleAddGroup = (): boolean => {
    const label = newGroupName.trim();
    if (!label) {
      toast.error("请输入分组名称");
      return false;
    }

    const existingValues = new Set([
      ...CONTEXT_TYPES.map((group) => group.value),
      ...customGroups.map((group) => group.value),
    ]);
    const baseValue = label
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "")
      .trim();
    let value = baseValue || label;
    while (existingValues.has(value)) {
      value = `${value}-${Math.random().toString(36).slice(2, 6)}`;
    }

    setCustomGroups((prev) => [...prev, { value, label, isCustom: true }]);
    setNewGroupName("");
    toast.success("分组已新增");
    return true;
  };

  const handleRemoveWord = async (word: string) => {
    try {
      await invoke("remove_word_from_daily_vocabulary_global", {
        word,
      });
      toast.success("删除成功");
      loadVocabulary();
    } catch (error) {
      console.error("Failed to remove word:", error);
      toast.error("删除失败");
    }
  };

  const handleUpdateContextType = async (word: string, contextType: string) => {
    setVocabularyItems((prev) =>
      prev.map((item) =>
        item.word === word ? { ...item, context_type: contextType } : item,
      ),
    );
    try {
      await invoke("update_word_context_type_global", {
        word,
        contextType,
      });
      toast.success("更新成功");
    } catch (error) {
      console.error("Failed to update context type:", error);
      toast.error("更新失败");
      loadVocabulary();
    }
  };

  const handlePromoteToHotword = async (
    word: string,
    contextType: string | null,
  ) => {
    try {
      await invoke("promote_word_to_hotword", {
        word,
        contextType,
        weight: 1.0,
      });
      toast.success(`"${word}" 已晋升为热词`);
    } catch (error) {
      console.error("Failed to promote to hotword:", error);
      toast.error("晋升失败");
    }
  };

  const baseGroups = useMemo<GroupDef[]>(
    () =>
      CONTEXT_TYPES.map((type) => ({ value: type.value, label: type.label })),
    [],
  );

  const autoGroups = useMemo<GroupDef[]>(() => {
    const existing = new Set(
      [...baseGroups, ...customGroups].map((group) => group.value),
    );
    const inferred = new Map<string, GroupDef>();
    vocabularyItems.forEach((item) => {
      if (!item.context_type) return;
      if (existing.has(item.context_type)) return;
      if (!inferred.has(item.context_type)) {
        inferred.set(item.context_type, {
          value: item.context_type,
          label: item.context_type,
        });
      }
    });
    return Array.from(inferred.values());
  }, [baseGroups, customGroups, vocabularyItems]);

  const groups = useMemo<GroupDef[]>(() => {
    const map = new Map<string, GroupDef>();
    [...baseGroups, ...customGroups, ...autoGroups].forEach((group) => {
      if (!map.has(group.value)) {
        map.set(group.value, group);
      }
    });
    return Array.from(map.values());
  }, [autoGroups, baseGroups, customGroups]);

  const searchedItems = useMemo(
    () =>
      vocabularyItems.filter(
        (item) =>
          searchQuery === "" ||
          item.word.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [vocabularyItems, searchQuery],
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const recentThreshold = nowSeconds - 24 * 60 * 60;

  const inboxItems = useMemo(
    () =>
      searchedItems.filter(
        (item) => (item.context_type || "other") === "other",
      ),
    [searchedItems],
  );

  const poolItems = useMemo(() => {
    switch (filterMode) {
      case "high":
        return inboxItems.filter((item) => item.frequency >= 2);
      case "recent":
        return inboxItems.filter((item) => item.updated_at >= recentThreshold);
      case "inbox":
      default:
        return inboxItems;
    }
  }, [filterMode, inboxItems, recentThreshold]);

  const sortedPoolItems = useMemo(() => {
    return [...poolItems].sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return b.updated_at - a.updated_at;
    });
  }, [poolItems]);

  const poolItemIds = useMemo(
    () => sortedPoolItems.map(getItemId),
    [sortedPoolItems],
  );

  const groupedByType = useMemo(() => {
    const acc: Record<string, DailyVocabularyItem[]> = {};
    groups.forEach((group) => {
      acc[group.value] = [];
    });
    searchedItems.forEach((item) => {
      const type = item.context_type || "other";
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(item);
    });
    Object.values(acc).forEach((items) => {
      items.sort((a, b) =>
        a.word.localeCompare(b.word, "zh-Hans-CN", { sensitivity: "base" }),
      );
    });
    return acc;
  }, [groups, searchedItems]);

  const inboxCount = inboxItems.length;
  const highFrequencyCount = inboxItems.filter(
    (item) => item.frequency >= 2,
  ).length;
  const recentCount = inboxItems.filter(
    (item) => item.updated_at >= recentThreshold,
  ).length;

  const panelGroups = useMemo(
    () => groups.filter((group) => group.value !== "other"),
    [groups],
  );

  const moveTargets = useMemo(() => {
    const normalized = panelGroups.map((group) => group);
    return [{ value: "other", label: "未归档" }, ...normalized];
  }, [panelGroups]);

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    return vocabularyItems.find((item) => getItemId(item) === activeId) || null;
  }, [activeId, vocabularyItems]);

  const activeColor = useMemo(() => {
    if (!activeItem) return "gray" as const;
    return getTypeColor(activeItem.context_type || "other");
  }, [activeItem]);

  const getDropTarget = (id: string) => {
    if (id === "pool-inbox") {
      return "other";
    }
    if (id.startsWith("group-")) {
      return id.replace("group-", "");
    }
    if (id.startsWith("item-")) {
      const itemId = Number(id.replace("item-", ""));
      const targetItem = vocabularyItems.find((item) => item.id === itemId);
      return targetItem ? targetItem.context_type || "other" : null;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    const rect =
      event.active.rect.current.translated || event.active.rect.current.initial;
    if (rect) {
      setActiveRect({ width: rect.width, height: rect.height });
    } else {
      setActiveRect(null);
    }

    const coordinates = event.activatorEvent
      ? getEventCoordinates(event.activatorEvent)
      : null;
    if (rect && coordinates) {
      setDragPointer({ x: coordinates.x, y: coordinates.y });
      setDragStartPointer({ x: coordinates.x, y: coordinates.y });
      setDragOffset({
        x: coordinates.x - rect.left,
        y: coordinates.y - rect.top,
      });
    } else {
      setDragPointer(null);
      setDragOffset(null);
      setDragStartPointer(null);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (!dragStartPointer) return;
    setDragPointer({
      x: dragStartPointer.x + event.delta.x,
      y: dragStartPointer.y + event.delta.y,
    });
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveId(null);
    setActiveRect(null);
    setDragPointer(null);
    setDragOffset(null);
    setDragStartPointer(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveRect(null);
    setDragPointer(null);
    setDragOffset(null);
    setDragStartPointer(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const targetType = getDropTarget(overId);
    if (!targetType) return;

    const activeEntry = vocabularyItems.find(
      (item) => getItemId(item) === activeId,
    );
    if (!activeEntry) return;

    const currentType = activeEntry.context_type || "other";
    if (currentType === targetType) return;

    handleUpdateContextType(activeEntry.word, targetType);
  };

  const dragOverlay =
    activeItem && dragPointer && dragOffset
      ? createPortal(
          <div
            style={{
              position: "fixed",
              left: dragPointer.x - dragOffset.x,
              top: dragPointer.y - dragOffset.y,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              borderRadius: "999px",
              background: "var(--color-panel)",
              boxShadow: "var(--shadow-3)",
              border: "1px solid var(--gray-6)",
              pointerEvents: "none",
              zIndex: 9999,
              width: activeRect ? `${activeRect.width}px` : undefined,
              height: activeRect ? `${activeRect.height}px` : undefined,
              boxSizing: "border-box",
              transform: "translateZ(0) scale(1.02)",
            }}
          >
            <DragHandleDots2Icon width="16" height="16" />
            <Badge size="2" variant="soft" color={activeColor}>
              <span
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
              >
                <span style={{ fontSize: "14px", fontWeight: 500 }}>
                  {activeItem.word}
                </span>
                <span style={{ fontSize: "12px", opacity: 0.6 }}>
                  ×{activeItem.frequency}
                </span>
              </span>
            </Badge>
          </div>,
          document.body,
        )
      : null;

  return (
    <Box p="4" style={{ cursor: activeId ? "grabbing" : "default" }}>
      <Flex direction="column" gap="4">
        <Heading size="6">每日词汇管理</Heading>

        <Card>
          <Flex gap="2" wrap="wrap" align="center">
            <TextField.Root
              placeholder="搜索词汇..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              size="2"
              style={{ minWidth: "200px", flex: "1 1 240px" }}
            />
            <Flex
              gap="2"
              wrap="wrap"
              align="center"
              style={{ flex: "2 1 380px" }}
            >
              <Button
                size="1"
                variant={filterMode === "inbox" ? "solid" : "soft"}
                onClick={() => setFilterMode("inbox")}
              >
                未归档 {inboxCount}
              </Button>
              <Button
                size="1"
                variant={filterMode === "high" ? "solid" : "soft"}
                onClick={() => setFilterMode("high")}
              >
                高频 {highFrequencyCount}
              </Button>
              <Button
                size="1"
                variant={filterMode === "recent" ? "solid" : "soft"}
                onClick={() => setFilterMode("recent")}
              >
                最近24h {recentCount}
              </Button>
            </Flex>
            <Flex gap="2" align="center" style={{ marginLeft: "auto" }}>
              <Button
                size="2"
                variant="soft"
                onClick={() => setAddGroupOpen(true)}
              >
                新增分组
              </Button>
              <Button size="2" onClick={() => setAddWordOpen(true)}>
                新增词汇
              </Button>
            </Flex>
          </Flex>
        </Card>

        {loading ? (
          <Text size="2" color="gray">
            加载中...
          </Text>
        ) : (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={rectIntersection}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <Flex direction="column" gap="3">
                <Card>
                  <Flex direction="column" gap="3">
                    <Flex justify="between" align="center">
                      <Flex align="center" gap="2">
                        <Text size="3" weight="bold">
                          词汇池
                        </Text>
                        <Badge size="1" variant="soft" color="gray">
                          {sortedPoolItems.length} 条
                        </Badge>
                      </Flex>
                      <Text size="1" color="gray">
                        拖拽到分组完成归档
                      </Text>
                    </Flex>

                    <DroppableContainer
                      id="pool-inbox"
                      isEmpty={sortedPoolItems.length === 0}
                      placeholder={searchQuery ? "无匹配结果" : "暂无词汇"}
                      minHeight="180px"
                    >
                      <SortableContext
                        items={poolItemIds}
                        strategy={rectSortingStrategy}
                      >
                        <Flex wrap="wrap" gap="2">
                          {sortedPoolItems.map((item) => (
                            <SortableWord
                              key={item.id}
                              item={item}
                              color={getTypeColor(item.context_type || "other")}
                              onPromote={handlePromoteToHotword}
                              onRemove={handleRemoveWord}
                              onMoveTo={handleUpdateContextType}
                              type={item.context_type || "other"}
                              availableGroups={moveTargets}
                            />
                          ))}
                        </Flex>
                      </SortableContext>
                    </DroppableContainer>
                  </Flex>
                </Card>

                <Flex direction="column" gap="2">
                  <Text size="2" weight="medium">
                    分组
                  </Text>
                  <Flex gap="3" wrap="wrap">
                    {panelGroups.map((group) => {
                      const items = groupedByType[group.value] || [];
                      return (
                        <Card
                          key={group.value}
                          style={{ flex: "1 1 240px", minWidth: "220px" }}
                        >
                          <Flex direction="column" gap="2">
                            <Flex justify="between" align="center">
                              <Text
                                size="2"
                                weight="bold"
                                color={getTypeColor(group.value)}
                              >
                                {group.label}
                              </Text>
                              <Badge
                                size="1"
                                variant="soft"
                                color={getTypeColor(group.value)}
                              >
                                {items.length}
                              </Badge>
                            </Flex>
                            <DroppableContainer
                              id={`group-${group.value}`}
                              isEmpty={items.length === 0}
                              placeholder="拖拽词汇到此处归档"
                              minHeight="120px"
                            >
                              <SortableContext
                                items={items.map(getItemId)}
                                strategy={rectSortingStrategy}
                              >
                                <Flex wrap="wrap" gap="2">
                                  {items.map((item) => (
                                    <SortableWord
                                      key={item.id}
                                      item={item}
                                      color={getTypeColor(group.value)}
                                      onPromote={handlePromoteToHotword}
                                      onRemove={handleRemoveWord}
                                      onMoveTo={handleUpdateContextType}
                                      type={item.context_type || group.value}
                                      availableGroups={moveTargets}
                                    />
                                  ))}
                                </Flex>
                              </SortableContext>
                            </DroppableContainer>
                          </Flex>
                        </Card>
                      );
                    })}
                  </Flex>
                </Flex>
              </Flex>
            </DndContext>
            {dragOverlay}
          </>
        )}

        <Dialog.Root open={addGroupOpen} onOpenChange={setAddGroupOpen}>
          <Dialog.Content style={{ maxWidth: 420 }}>
            <Dialog.Title>新增分组</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="3">
              添加一个新的分组用于归档词汇
            </Dialog.Description>
            <Flex direction="column" gap="3">
              <TextField.Root
                placeholder="分组名称"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const success = handleAddGroup();
                    if (success) {
                      setAddGroupOpen(false);
                    }
                  }
                }}
              />
              <Flex justify="end" gap="2">
                <Dialog.Close>
                  <Button variant="soft">取消</Button>
                </Dialog.Close>
                <Button
                  onClick={() => {
                    const success = handleAddGroup();
                    if (success) {
                      setAddGroupOpen(false);
                    }
                  }}
                >
                  确认新增
                </Button>
              </Flex>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>

        <Dialog.Root open={addWordOpen} onOpenChange={setAddWordOpen}>
          <Dialog.Content style={{ maxWidth: 460 }}>
            <Dialog.Title>新增词汇</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="3">
              新增词汇并选择归档分组
            </Dialog.Description>
            <Flex direction="column" gap="3">
              <TextField.Root
                placeholder="词汇内容"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddWord().then((success) => {
                      if (success) {
                        setAddWordOpen(false);
                      }
                    });
                  }
                }}
              />
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <Button variant="soft">
                    {moveTargets.find((group) => group.value === newWordType)
                      ?.label || "选择分组"}
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  {moveTargets.map((group) => (
                    <DropdownMenu.Item
                      key={group.value}
                      onClick={() => setNewWordType(group.value)}
                    >
                      {group.label}
                      {newWordType === group.value && " ✓"}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              <Flex justify="end" gap="2">
                <Dialog.Close>
                  <Button variant="soft">取消</Button>
                </Dialog.Close>
                <Button
                  onClick={() => {
                    handleAddWord().then((success) => {
                      if (success) {
                        setAddWordOpen(false);
                      }
                    });
                  }}
                  disabled={!newWord.trim()}
                >
                  确认新增
                </Button>
              </Flex>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>
    </Box>
  );
}
