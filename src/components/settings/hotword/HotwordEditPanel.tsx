import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconCheck,
  IconMinus,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import {
  type Hotword,
  type HotwordCategory,
  type HotwordCategoryMeta,
  type HotwordScenario,
  SCENARIO_LABELS,
  SOURCE_LABELS,
} from "../../../types/hotword";
import { resolveIcon } from "../../../lib/hotwordIcons";

type AliasBucket = "correction" | "force";

const LABEL_CLASS_NAME = "shrink-0 w-11";
const ROW_MIN_HEIGHT_CLASS_NAME = "min-h-9";

const DROP_ID: Record<AliasBucket, string> = {
  correction: "alias-drop-correction",
  force: "alias-drop-force",
};

const DraggableAliasTag: React.FC<{
  bucket: AliasBucket;
  value: string;
  color: "gray" | "orange";
  onRemove: (value: string) => void;
}> = ({ bucket, value, color, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `${bucket}:${value}`,
      data: { bucket, value },
    });

  return (
    <Badge
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      size="1"
      variant="soft"
      color={color}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.7 : undefined,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`px-1.5 py-0.5 gap-1 select-none ${
        isDragging
          ? "shadow-lg scale-105"
          : "cursor-grab active:cursor-grabbing"
      }`}
    >
      {value}
      <IconX
        size={11}
        className="cursor-pointer hover:text-red-600 opacity-60 hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(value);
        }}
      />
    </Badge>
  );
};

const AliasDropLane: React.FC<{
  bucket: AliasBucket;
  label: string;
  description: string;
  isDragging: boolean;
  isAdding: boolean;
  onBeginAdd: () => void;
  inputValue: string;
  inputPlaceholder: string;
  onInputChange: (value: string) => void;
  onInputSubmit: () => void;
  onInputCancel: () => void;
  children: React.ReactNode;
}> = ({
  bucket,
  label,
  description,
  isDragging,
  isAdding,
  onBeginAdd,
  inputValue,
  inputPlaceholder,
  onInputChange,
  onInputSubmit,
  onInputCancel,
  children,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_ID[bucket] });

  return (
    <Flex gap="2" align="center" className={ROW_MIN_HEIGHT_CLASS_NAME}>
      <Tooltip content={description}>
        <Text
          size="1"
          color="gray"
          weight="medium"
          className={`${LABEL_CLASS_NAME} cursor-help`}
        >
          {label}
        </Text>
      </Tooltip>
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-md px-2 transition-all ${ROW_MIN_HEIGHT_CLASS_NAME} ${
          isDragging
            ? isOver
              ? "border border-blue-400 bg-blue-50/60"
              : "border border-gray-300 bg-gray-50/60"
            : "border border-transparent bg-transparent"
        }`}
      >
        <Flex align="center" gap="2" className={`${ROW_MIN_HEIGHT_CLASS_NAME}`}>
          <Flex
            wrap="wrap"
            gap="1"
            align="center"
            className={`flex-1 min-w-0 content-center ${ROW_MIN_HEIGHT_CLASS_NAME}`}
          >
            {children}
          </Flex>
          {isAdding ? (
            <Flex
              align="center"
              justify="end"
              gap="1"
              className={`shrink-0 min-w-[148px] ${ROW_MIN_HEIGHT_CLASS_NAME}`}
            >
              <TextField.Root
                size="1"
                value={inputValue}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder={inputPlaceholder}
                className="w-36"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onInputSubmit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onInputCancel();
                  }
                }}
                onBlur={() => {
                  if (inputValue.trim()) {
                    onInputSubmit();
                  } else {
                    onInputCancel();
                  }
                }}
                autoFocus
              />
            </Flex>
          ) : (
            <Tooltip content={`添加${label}词`}>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                className="shrink-0"
                onClick={onBeginAdd}
              >
                <IconPlus size={12} />
              </IconButton>
            </Tooltip>
          )}
        </Flex>
      </div>
    </Flex>
  );
};

interface HotwordEditPanelProps {
  hotword: Hotword;
  onUpdate: () => void;
  onDelete: (id: number) => void;
  categoryMap: Record<string, HotwordCategoryMeta>;
  sortedIds: string[];
}

export function HotwordEditPanel({
  hotword,
  onUpdate,
  onDelete,
  categoryMap,
  sortedIds,
}: HotwordEditPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [target, setTarget] = useState(hotword.target);
  const [originals, setOriginals] = useState<string[]>(hotword.originals);
  const [forceReplaceOriginals, setForceReplaceOriginals] = useState<string[]>(
    hotword.force_replace_originals,
  );
  const [category, setCategory] = useState<HotwordCategory>(hotword.category);
  const [scenarios, setScenarios] = useState<HotwordScenario[]>(
    hotword.scenarios,
  );
  const [newOriginal, setNewOriginal] = useState("");
  const [newForceReplaceOriginal, setNewForceReplaceOriginal] = useState("");
  const [addingBucket, setAddingBucket] = useState<AliasBucket | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [useCount, setUseCount] = useState(hotword.use_count);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingAlias, setIsDraggingAlias] = useState(false);

  useEffect(() => {
    setTarget(hotword.target);
    setOriginals(hotword.originals);
    setForceReplaceOriginals(hotword.force_replace_originals);
    setCategory(hotword.category);
    setScenarios(hotword.scenarios);
    setUseCount(hotword.use_count);
    setNewOriginal("");
    setNewForceReplaceOriginal("");
    setAddingBucket(null);
    setConfirmDelete(false);
  }, [
    hotword.id,
    hotword.target,
    hotword.originals,
    hotword.force_replace_originals,
    hotword.category,
    hotword.scenarios,
    hotword.use_count,
  ]);

  const hasChanges = useMemo(() => {
    if (target.trim() !== hotword.target) return true;
    if (category !== hotword.category) return true;
    if (JSON.stringify(originals) !== JSON.stringify(hotword.originals))
      return true;
    if (
      JSON.stringify(forceReplaceOriginals) !==
      JSON.stringify(hotword.force_replace_originals)
    ) {
      return true;
    }
    if (JSON.stringify(scenarios) !== JSON.stringify(hotword.scenarios))
      return true;
    return false;
  }, [target, originals, forceReplaceOriginals, category, scenarios, hotword]);

  const addAlias = (
    rawValue: string,
    current: string[],
    sibling: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    reset: () => void,
  ) => {
    const trimmed = rawValue.trim();
    if (!trimmed) return;
    const existsInCurrent = current.some((item) => item === trimmed);
    const existsInSibling = sibling.some((item) => item === trimmed);
    if (existsInCurrent || existsInSibling) return;
    setter((prev) => [...prev, trimmed]);
    reset();
  };

  const moveAlias = (value: string, from: AliasBucket, to: AliasBucket) => {
    if (from === to) return;
    if (to === "correction") {
      setForceReplaceOriginals((prev) => prev.filter((item) => item !== value));
      setOriginals((prev) => (prev.includes(value) ? prev : [...prev, value]));
    } else {
      setOriginals((prev) => prev.filter((item) => item !== value));
      setForceReplaceOriginals((prev) =>
        prev.includes(value) ? prev : [...prev, value],
      );
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setIsDraggingAlias(false);
    if (!over) return;
    const payload = active.data.current as
      | { bucket: AliasBucket; value: string }
      | undefined;
    if (!payload) return;
    const nextBucket =
      over.id === DROP_ID.correction
        ? "correction"
        : over.id === DROP_ID.force
          ? "force"
          : null;
    if (!nextBucket) return;
    moveAlias(payload.value, payload.bucket, nextBucket);
  };

  const handleDragStart = (_event: DragStartEvent) => {
    setIsDraggingAlias(true);
  };

  const beginAdd = (bucket: AliasBucket) => {
    setAddingBucket(bucket);
  };

  const cancelAdd = (bucket: AliasBucket) => {
    if (bucket === "correction") {
      setNewOriginal("");
    } else {
      setNewForceReplaceOriginal("");
    }
    setAddingBucket((current) => (current === bucket ? null : current));
  };

  const handleSave = async () => {
    if (!target.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const newTarget = target.trim() !== hotword.target ? target.trim() : null;
      await invoke("update_hotword", {
        id: hotword.id,
        target: newTarget,
        originals,
        forceReplaceOriginals,
        category,
        scenarios,
      });
      onUpdate();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("UNIQUE constraint")) {
        setError(`「${target.trim()}」已存在`);
      } else {
        setError("保存失败");
      }
      console.error("[HotwordEditPanel] Save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleAdjustUseCount = async (delta: number) => {
    try {
      const newCount = await invoke<number>("adjust_hotword_use_count", {
        id: hotword.id,
        delta,
      });
      setUseCount(newCount);
      onUpdate();
    } catch (e) {
      console.error("[HotwordEditPanel] Adjust use_count failed:", e);
    }
  };

  const handleScenarioToggle = (scenario: HotwordScenario) => {
    setScenarios((prev) =>
      prev.includes(scenario)
        ? prev.filter((s) => s !== scenario)
        : [...prev, scenario],
    );
  };

  const sourceColor =
    hotword.source === "auto_learned"
      ? "cyan"
      : hotword.source === "ai_extracted"
        ? "violet"
        : "gray";

  const correctionEmpty = originals.length === 0;
  const forceEmpty = forceReplaceOriginals.length === 0;

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white animate-fade-in-up overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <Flex align="center" gap="3">
          <TextField.Root
            size="2"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="font-medium flex-1 max-w-[200px]"
            placeholder="目标词"
          />
          <Flex gap="2" align="center" className="flex-1">
            <Badge size="1" variant="soft" color={sourceColor}>
              {SOURCE_LABELS[hotword.source]}
            </Badge>
            <Flex align="center" gap="1">
              <Tooltip content="减少权重">
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => handleAdjustUseCount(-1)}
                  disabled={useCount <= 0}
                >
                  <IconMinus size={10} />
                </IconButton>
              </Tooltip>
              <Text size="1" color="gray" className="min-w-[3ch] text-center">
                {useCount}
              </Text>
              <Tooltip content="增加权重">
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => handleAdjustUseCount(1)}
                >
                  <IconPlus size={10} />
                </IconButton>
              </Tooltip>
            </Flex>
            {hotword.false_positive_count > 0 && (
              <Text size="1" color="red">
                误报 {hotword.false_positive_count}
              </Text>
            )}
          </Flex>
          <Flex gap="2" align="center">
            {hasChanges && (
              <Button
                size="1"
                variant="solid"
                onClick={handleSave}
                disabled={!target.trim() || saving}
              >
                <IconCheck size={12} />
                保存
              </Button>
            )}
            <Tooltip content="删除热词">
              <IconButton
                size="1"
                variant="ghost"
                color="red"
                onClick={() => setConfirmDelete(true)}
              >
                <IconTrash size={14} />
              </IconButton>
            </Tooltip>
          </Flex>
        </Flex>
        {error && (
          <Text size="1" color="red" weight="medium" className="mt-1 block">
            {error}
          </Text>
        )}
      </div>

      <div className="px-4 py-3">
        <Flex direction="column" gap="3">
          <Flex gap="2" align="center" className={ROW_MIN_HEIGHT_CLASS_NAME}>
            <Text
              size="1"
              color="gray"
              weight="medium"
              className={LABEL_CLASS_NAME}
            >
              类别
            </Text>
            <Flex
              gap="1"
              wrap="wrap"
              align="center"
              className={ROW_MIN_HEIGHT_CLASS_NAME}
            >
              {sortedIds.map((key) => {
                const meta = categoryMap[key];
                if (!meta) return null;
                const Icon = resolveIcon(meta.icon);
                const isActive = category === key;
                const chipColor = (meta.color || "gray") as
                  | "green"
                  | "orange"
                  | "blue"
                  | "purple"
                  | "gray";
                return (
                  <Badge
                    key={key}
                    size="1"
                    variant={isActive ? "solid" : "outline"}
                    color={chipColor}
                    className={`px-2 py-0.5 cursor-pointer select-none transition-opacity duration-100 ${
                      isActive ? "" : "opacity-50 hover:opacity-80"
                    }`}
                    onClick={() => setCategory(key)}
                  >
                    <Flex align="center" gap="1">
                      <Icon size={11} />
                      {meta.label}
                    </Flex>
                  </Badge>
                );
              })}
            </Flex>
          </Flex>

          <Flex gap="2" align="center" className={ROW_MIN_HEIGHT_CLASS_NAME}>
            <Text
              size="1"
              color="gray"
              weight="medium"
              className={LABEL_CLASS_NAME}
            >
              场景
            </Text>
            <Flex
              gap="1"
              wrap="wrap"
              align="center"
              className={ROW_MIN_HEIGHT_CLASS_NAME}
            >
              {(
                Object.entries(SCENARIO_LABELS) as [HotwordScenario, string][]
              ).map(([key, label]) => {
                const isActive = scenarios.includes(key);
                return (
                  <Badge
                    key={key}
                    size="1"
                    variant={isActive ? "solid" : "outline"}
                    color="gray"
                    className={`px-2 py-0.5 cursor-pointer select-none transition-opacity duration-100 ${
                      isActive ? "" : "opacity-40 hover:opacity-70"
                    }`}
                    onClick={() => handleScenarioToggle(key)}
                  >
                    {label}
                  </Badge>
                );
              })}
            </Flex>
          </Flex>

          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setIsDraggingAlias(false)}
          >
            <Flex direction="column" gap="3">
              <AliasDropLane
                bucket="correction"
                label="纠错"
                description="参与纠错参考与 LLM 注入。可把某个别名拖到“强替”中，转成本地直接替换。"
                isDragging={isDraggingAlias}
                isAdding={addingBucket === "correction"}
                onBeginAdd={() => beginAdd("correction")}
                inputValue={newOriginal}
                inputPlaceholder="添加纠错词"
                onInputChange={setNewOriginal}
                onInputSubmit={() => {
                  addAlias(
                    newOriginal,
                    originals,
                    forceReplaceOriginals,
                    setOriginals,
                    () => {
                      setNewOriginal("");
                      setAddingBucket(null);
                    },
                  );
                }}
                onInputCancel={() => cancelAdd("correction")}
              >
                {originals.map((tag) => (
                  <DraggableAliasTag
                    key={`correction-${tag}`}
                    bucket="correction"
                    value={tag}
                    color="gray"
                    onRemove={(value) =>
                      setOriginals((prev) =>
                        prev.filter((item) => item !== value),
                      )
                    }
                  />
                ))}
                {correctionEmpty && addingBucket !== "correction" && (
                  <Text size="1" color="gray">
                    暂无
                  </Text>
                )}
              </AliasDropLane>

              <AliasDropLane
                bucket="force"
                label="强替"
                description="仅做本地精确替换，不进入 LLM。可把某个别名拖回“纠错”中恢复 AI 参考。"
                isDragging={isDraggingAlias}
                isAdding={addingBucket === "force"}
                onBeginAdd={() => beginAdd("force")}
                inputValue={newForceReplaceOriginal}
                inputPlaceholder="添加强替词"
                onInputChange={setNewForceReplaceOriginal}
                onInputSubmit={() => {
                  addAlias(
                    newForceReplaceOriginal,
                    forceReplaceOriginals,
                    originals,
                    setForceReplaceOriginals,
                    () => {
                      setNewForceReplaceOriginal("");
                      setAddingBucket(null);
                    },
                  );
                }}
                onInputCancel={() => cancelAdd("force")}
              >
                {forceReplaceOriginals.map((tag) => (
                  <DraggableAliasTag
                    key={`force-${tag}`}
                    bucket="force"
                    value={tag}
                    color="orange"
                    onRemove={(value) =>
                      setForceReplaceOriginals((prev) =>
                        prev.filter((item) => item !== value),
                      )
                    }
                  />
                ))}
                {forceEmpty && addingBucket !== "force" && (
                  <Text size="1" color="gray">
                    暂无
                  </Text>
                )}
              </AliasDropLane>
            </Flex>
          </DndContext>
        </Flex>
      </div>

      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description size="2">
            确定要删除热词「{hotword.target}」吗？
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
                onClick={() => onDelete(hotword.id)}
              >
                删除
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}
