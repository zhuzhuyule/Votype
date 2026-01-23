// HotwordSettings - Manage hotwords with category filtering, add/edit dialogs, import/export

import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DropdownMenu,
  Flex,
  IconButton,
  RadioGroup,
  SegmentedControl,
  Table,
  Text,
  TextArea,
  TextField,
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
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
  SCENARIO_LABELS,
} from "../../types/hotword";
import { Card } from "../ui/Card";

// Filter type includes "all" plus all categories
type FilterType = "all" | HotwordCategory;

// AddHotwordDialog sub-component
interface AddHotwordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => Promise<void>;
}

const AddHotwordDialog: React.FC<AddHotwordDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
}) => {
  const [target, setTarget] = useState("");
  const [originalsText, setOriginalsText] = useState("");
  const [category, setCategory] = useState<HotwordCategory>("term");
  const [inferredCategory, setInferredCategory] =
    useState<HotwordCategory | null>(null);
  const [scenarios, setScenarios] = useState<HotwordScenario[]>([
    "work",
    "casual",
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-infer category when target changes
  useEffect(() => {
    if (!target.trim()) {
      setInferredCategory(null);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const [inferred] = await invoke<[HotwordCategory, number]>(
          "infer_hotword_category",
          { target: target.trim() },
        );
        setInferredCategory(inferred);
        setCategory(inferred);
      } catch (e) {
        console.error("[AddHotwordDialog] Failed to infer category:", e);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [target]);

  const handleScenarioToggle = (scenario: HotwordScenario) => {
    setScenarios((prev) =>
      prev.includes(scenario)
        ? prev.filter((s) => s !== scenario)
        : [...prev, scenario],
    );
  };

  const handleSubmit = async () => {
    if (!target.trim()) return;

    setIsSubmitting(true);
    try {
      const originals = originalsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await onAdd(target.trim(), originals, category, scenarios);
      // Reset form
      setTarget("");
      setOriginalsText("");
      setCategory("term");
      setInferredCategory(null);
      setScenarios(["work", "casual"]);
      onOpenChange(false);
    } catch (e) {
      console.error("[AddHotwordDialog] Failed to add hotword:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>添加热词</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          添加新的热词以提高语音识别准确度
        </Dialog.Description>

        <Flex direction="column" gap="4">
          {/* Target word */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              目标词 <Text color="red">*</Text>
            </Text>
            <TextField.Root
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="输入正确的词汇"
            />
          </Flex>

          {/* Original variants */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              原始变体
            </Text>
            <TextField.Root
              value={originalsText}
              onChange={(e) => setOriginalsText(e.target.value)}
              placeholder="逗号分隔的变体，如：变体1, 变体2"
            />
            <Text size="1" color="gray">
              语音识别可能产生的错误形式
            </Text>
          </Flex>

          {/* Category selection */}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              类别
            </Text>
            <RadioGroup.Root
              value={category}
              onValueChange={(v) => setCategory(v as HotwordCategory)}
            >
              <Flex gap="3" wrap="wrap">
                {(
                  Object.entries(CATEGORY_LABELS) as [HotwordCategory, string][]
                ).map(([key, label]) => (
                  <Flex key={key} align="center" gap="1">
                    <RadioGroup.Item value={key} id={`cat-${key}`} />
                    <Text as="label" htmlFor={`cat-${key}`} size="2">
                      {CATEGORY_ICONS[key]} {label}
                      {inferredCategory === key && (
                        <Text color="gray" size="1">
                          {" "}
                          (推断)
                        </Text>
                      )}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </RadioGroup.Root>
          </Flex>

          {/* Scenarios selection */}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              适用场景
            </Text>
            <Flex gap="3">
              {(
                Object.entries(SCENARIO_LABELS) as [HotwordScenario, string][]
              ).map(([key, label]) => (
                <Flex key={key} align="center" gap="1">
                  <Checkbox
                    checked={scenarios.includes(key)}
                    onCheckedChange={() => handleScenarioToggle(key)}
                    id={`scenario-${key}`}
                  />
                  <Text as="label" htmlFor={`scenario-${key}`} size="2">
                    {label}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              取消
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={!target.trim() || isSubmitting}
          >
            添加
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

// EditHotwordDialog sub-component
interface EditHotwordDialogProps {
  hotword: Hotword | null;
  onOpenChange: (open: boolean) => void;
  onSave: (
    id: number,
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => Promise<void>;
}

const EditHotwordDialog: React.FC<EditHotwordDialogProps> = ({
  hotword,
  onOpenChange,
  onSave,
}) => {
  const [target, setTarget] = useState("");
  const [originalsText, setOriginalsText] = useState("");
  const [category, setCategory] = useState<HotwordCategory>("term");
  const [scenarios, setScenarios] = useState<HotwordScenario[]>([
    "work",
    "casual",
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form when hotword changes
  useEffect(() => {
    if (hotword) {
      setTarget(hotword.target);
      setOriginalsText(hotword.originals.join(", "));
      setCategory(hotword.category);
      setScenarios(hotword.scenarios);
    }
  }, [hotword]);

  const handleScenarioToggle = (scenario: HotwordScenario) => {
    setScenarios((prev) =>
      prev.includes(scenario)
        ? prev.filter((s) => s !== scenario)
        : [...prev, scenario],
    );
  };

  const handleSubmit = async () => {
    if (!hotword || !target.trim()) return;

    setIsSubmitting(true);
    try {
      const originals = originalsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await onSave(hotword.id, target.trim(), originals, category, scenarios);
      onOpenChange(false);
    } catch (e) {
      console.error("[EditHotwordDialog] Failed to save hotword:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={hotword !== null} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>编辑热词</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          修改热词的属性
        </Dialog.Description>

        <Flex direction="column" gap="4">
          {/* Target word */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              目标词 <Text color="red">*</Text>
            </Text>
            <TextField.Root
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="输入正确的词汇"
            />
          </Flex>

          {/* Original variants */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              原始变体
            </Text>
            <TextField.Root
              value={originalsText}
              onChange={(e) => setOriginalsText(e.target.value)}
              placeholder="逗号分隔的变体，如：变体1, 变体2"
            />
            <Text size="1" color="gray">
              语音识别可能产生的错误形式
            </Text>
          </Flex>

          {/* Category selection */}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              类别
            </Text>
            <RadioGroup.Root
              value={category}
              onValueChange={(v) => setCategory(v as HotwordCategory)}
            >
              <Flex gap="3" wrap="wrap">
                {(
                  Object.entries(CATEGORY_LABELS) as [HotwordCategory, string][]
                ).map(([key, label]) => (
                  <Flex key={key} align="center" gap="1">
                    <RadioGroup.Item value={key} id={`edit-cat-${key}`} />
                    <Text as="label" htmlFor={`edit-cat-${key}`} size="2">
                      {CATEGORY_ICONS[key]} {label}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </RadioGroup.Root>
          </Flex>

          {/* Scenarios selection */}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              适用场景
            </Text>
            <Flex gap="3">
              {(
                Object.entries(SCENARIO_LABELS) as [HotwordScenario, string][]
              ).map(([key, label]) => (
                <Flex key={key} align="center" gap="1">
                  <Checkbox
                    checked={scenarios.includes(key)}
                    onCheckedChange={() => handleScenarioToggle(key)}
                    id={`edit-scenario-${key}`}
                  />
                  <Text as="label" htmlFor={`edit-scenario-${key}`} size="2">
                    {label}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              取消
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={!target.trim() || isSubmitting}
          >
            保存
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

// BatchAddDialog sub-component
interface BatchAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBatchAdd: (targets: string[]) => Promise<void>;
}

const BatchAddDialog: React.FC<BatchAddDialogProps> = ({
  open,
  onOpenChange,
  onBatchAdd,
}) => {
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const targets = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const previewCount = targets.length;

  const handleSubmit = async () => {
    if (previewCount === 0) return;

    setIsSubmitting(true);
    try {
      await onBatchAdd(targets);
      setText("");
      onOpenChange(false);
    } catch (e) {
      console.error("[BatchAddDialog] Failed to batch add:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>批量添加热词</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          每行输入一个目标词，系统将自动推断类别
        </Dialog.Description>

        <Flex direction="column" gap="3">
          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入热词，每行一个..."
            rows={8}
          />
          {previewCount > 0 && (
            <Text size="2" color="gray">
              将添加 {previewCount} 个热词
            </Text>
          )}
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              取消
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={previewCount === 0 || isSubmitting}
          >
            添加 {previewCount > 0 && `(${previewCount})`}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

// Main HotwordSettings component
export const HotwordSettings: React.FC = () => {
  const [hotwords, setHotwords] = useState<Hotword[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [editingHotword, setEditingHotword] = useState<Hotword | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Load hotwords
  const loadHotwords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Hotword[]>("get_hotwords");
      setHotwords(result);
    } catch (e) {
      console.error("[HotwordSettings] Failed to load hotwords:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHotwords();
  }, [loadHotwords]);

  // Filter hotwords by category (with null safety)
  const filteredHotwords = React.useMemo(
    () =>
      filter === "all"
        ? hotwords.filter((h) => h != null)
        : hotwords.filter((h) => h != null && h.category === filter),
    [filter, hotwords],
  );

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter]);

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

  // Add hotword handler
  const handleAddHotword = async (
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => {
    const newHotword = await invoke<Hotword>("add_hotword", {
      target,
      originals,
      category,
      scenarios,
    });
    setHotwords((prev) => [...prev, newHotword]);
  };

  // Batch add handler
  const handleBatchAdd = async (targets: string[]) => {
    for (const target of targets) {
      try {
        // Infer category for each target
        const [category] = await invoke<[HotwordCategory, number]>(
          "infer_hotword_category",
          { target },
        );
        const newHotword = await invoke<Hotword>("add_hotword", {
          target,
          originals: [],
          category,
          scenarios: ["work", "casual"],
        });
        setHotwords((prev) => [...prev, newHotword]);
      } catch (e) {
        console.error(`[HotwordSettings] Failed to add "${target}":`, e);
      }
    }
  };

  // Edit handler
  const handleEditHotword = async (
    id: number,
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => {
    try {
      const updatedHotword = await invoke<Hotword>("update_hotword", {
        id,
        target,
        originals,
        category,
        scenarios,
      });
      if (updatedHotword) {
        setHotwords((prev) =>
          prev.map((h) => (h && h.id === id ? updatedHotword : h)),
        );
      }
    } catch (e) {
      console.error(`[HotwordSettings] Failed to edit hotword ${id}:`, e);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (deleteId === null) return;

    try {
      await invoke("delete_hotword", { id: deleteId });
      setHotwords((prev) => prev.filter((h) => h && h.id !== deleteId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteId);
        return next;
      });
    } catch (e) {
      console.error("[HotwordSettings] Failed to delete hotword:", e);
    } finally {
      setDeleteId(null);
    }
  };

  // Selection handlers
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredHotwords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(
        new Set(filteredHotwords.filter((h) => h != null).map((h) => h.id)),
      );
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Batch action handlers
  const handleBatchChangeCategory = async (newCategory: HotwordCategory) => {
    const updates: Map<number, Hotword> = new Map();

    for (const id of selectedIds) {
      const hotword = hotwords.find((h) => h && h.id === id);
      if (hotword && hotword.category !== newCategory) {
        try {
          const updated = await invoke<Hotword>("update_hotword", {
            id,
            target: hotword.target,
            originals: hotword.originals,
            category: newCategory,
            scenarios: hotword.scenarios,
          });
          if (updated) {
            updates.set(id, updated);
          }
        } catch (e) {
          console.error(`[HotwordSettings] Failed to update hotword ${id}:`, e);
        }
      }
    }

    // Single state update with all changes
    if (updates.size > 0) {
      setHotwords((prev) =>
        prev.map((h) => (h && updates.has(h.id) ? updates.get(h.id)! : h)),
      );
    }
    clearSelection();
  };

  const handleBatchChangeScenarios = async (
    newScenarios: HotwordScenario[],
  ) => {
    const updates: Map<number, Hotword> = new Map();

    for (const id of selectedIds) {
      const hotword = hotwords.find((h) => h && h.id === id);
      if (hotword) {
        try {
          const updated = await invoke<Hotword>("update_hotword", {
            id,
            target: hotword.target,
            originals: hotword.originals,
            category: hotword.category,
            scenarios: newScenarios,
          });
          if (updated) {
            updates.set(id, updated);
          }
        } catch (e) {
          console.error(`[HotwordSettings] Failed to update hotword ${id}:`, e);
        }
      }
    }

    // Single state update with all changes
    if (updates.size > 0) {
      setHotwords((prev) =>
        prev.map((h) => (h && updates.has(h.id) ? updates.get(h.id)! : h)),
      );
    }
    clearSelection();
  };

  const handleBatchDelete = async () => {
    const deletedIds: Set<number> = new Set();

    for (const id of selectedIds) {
      try {
        await invoke("delete_hotword", { id });
        deletedIds.add(id);
      } catch (e) {
        console.error(`[HotwordSettings] Failed to delete hotword ${id}:`, e);
      }
    }

    // Single state update
    if (deletedIds.size > 0) {
      setHotwords((prev) => prev.filter((h) => h && !deletedIds.has(h.id)));
    }
    clearSelection();
  };

  // Export handler
  const handleExport = () => {
    const exportData = {
      version: "2.0",
      hotwords: hotwords.map((h) => ({
        target: h.target,
        originals: h.originals,
        category: h.category,
        scenarios: h.scenarios,
      })),
    };
    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hotwords.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import handler
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);

        // Support both old string[] format and new object format
        if (Array.isArray(imported)) {
          // Old format: string[]
          for (const target of imported) {
            if (typeof target === "string" && target.trim()) {
              const [category] = await invoke<[HotwordCategory, number]>(
                "infer_hotword_category",
                { target: target.trim() },
              );
              const newHotword = await invoke<Hotword>("add_hotword", {
                target: target.trim(),
                originals: [],
                category,
                scenarios: ["work", "casual"],
              });
              setHotwords((prev) => [...prev, newHotword]);
            }
          }
        } else if (
          imported.version === "2.0" &&
          Array.isArray(imported.hotwords)
        ) {
          // New format: { version: "2.0", hotwords: [...] }
          for (const h of imported.hotwords) {
            if (h.target && typeof h.target === "string") {
              const newHotword = await invoke<Hotword>("add_hotword", {
                target: h.target.trim(),
                originals: Array.isArray(h.originals) ? h.originals : [],
                category: h.category || "term",
                scenarios: Array.isArray(h.scenarios)
                  ? h.scenarios
                  : ["work", "casual"],
              });
              setHotwords((prev) => [...prev, newHotword]);
            }
          }
        }
      } catch (err) {
        console.error("[HotwordSettings] Import failed:", err);
      }
    };
    input.click();
  };

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
                onCheckedChange={() => toggleSelect(h.id)}
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
                  onClick={() => setEditingHotword(h)}
                >
                  <IconPencil size={14} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="1"
                  color="red"
                  onClick={() => setDeleteId(h.id)}
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
    <>
      <Card className="max-w-5xl w-full mx-auto p-0 flex flex-col">
        <Flex direction="column" className="h-full">
          {/* Fixed Header */}
          <div className="p-6 pb-4 border-b border-gray-100 shrink-0 bg-white z-10">
            <Flex direction="column" gap="4">
              {/* Filter tabs */}
              <Flex justify="center">
                <SegmentedControl.Root
                  value={filter}
                  onValueChange={(v) => setFilter(v as FilterType)}
                  size="2"
                >
                  <SegmentedControl.Item value="all">
                    <Text size="2">全部</Text>
                  </SegmentedControl.Item>
                  {(
                    Object.entries(CATEGORY_LABELS) as [
                      HotwordCategory,
                      string,
                    ][]
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
                            onClick={() => handleBatchChangeCategory(key)}
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
                          onClick={() => handleBatchChangeScenarios(["work"])}
                        >
                          仅工作
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onClick={() => handleBatchChangeScenarios(["casual"])}
                        >
                          仅日常
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onClick={() =>
                            handleBatchChangeScenarios(["work", "casual"])
                          }
                        >
                          工作 + 日常
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                    <Button
                      variant="soft"
                      color="red"
                      onClick={handleBatchDelete}
                    >
                      <IconTrash size={14} />
                      删除
                    </Button>
                    <Button variant="ghost" onClick={clearSelection}>
                      取消选择
                    </Button>
                  </Flex>
                </Flex>
              ) : (
                <Flex gap="2" justify="end">
                  <Button
                    variant="soft"
                    onClick={() => setBatchDialogOpen(true)}
                  >
                    <IconPlus size={14} />
                    批量添加
                  </Button>
                  <Button onClick={() => setAddDialogOpen(true)}>
                    <IconPlus size={14} />
                    添加
                  </Button>
                  <Button variant="soft" onClick={handleImport}>
                    <IconUpload size={14} />
                    导入
                  </Button>
                  <Button
                    variant="soft"
                    onClick={handleExport}
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
                        onCheckedChange={toggleSelectAll}
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
                              onCheckedChange={() => toggleSelect(h.id)}
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
                                <Badge
                                  key={i}
                                  size="1"
                                  color="gray"
                                  variant="soft"
                                >
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
                                <Badge
                                  key={s}
                                  size="1"
                                  color="blue"
                                  variant="soft"
                                >
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
                                onClick={() => setEditingHotword(h)}
                              >
                                <IconPencil size={14} />
                              </IconButton>
                              <IconButton
                                variant="ghost"
                                size="1"
                                color="red"
                                onClick={() => setDeleteId(h.id)}
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
      </Card>

      {/* Add Dialog */}
      <AddHotwordDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAddHotword}
      />

      {/* Batch Add Dialog */}
      <BatchAddDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        onBatchAdd={handleBatchAdd}
      />

      {/* Edit Dialog */}
      <EditHotwordDialog
        hotword={editingHotword}
        onOpenChange={() => setEditingHotword(null)}
        onSave={handleEditHotword}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog.Root
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
      >
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description size="2">
            确定要删除这个热词吗？此操作无法撤销。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={handleDelete}>
                删除
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
};
