# Hotword Tag Cloud UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Hotwords tab table+dialog UI with a tag cloud layout featuring inline editing, improving information density and reducing interaction steps.

**Architecture:** Frontend-only change. Replace HotwordTable + 3 Dialog components with HotwordTagCloud (main view with grouped tags, search, suggestions) + HotwordEditPanel (inline edit below selected tag) + HotwordAddBar (inline input). All backend APIs remain unchanged. HotwordSettings keeps all data logic, only swaps its child component.

**Tech Stack:** React 18, TypeScript, Radix UI Themes (Badge, Flex, Box, Text, RadioGroup, Checkbox, TextField, Tooltip, AlertDialog), Tailwind CSS 4, Tabler Icons. Reuses existing TagInput component from `src/components/settings/post-processing/prompts/components/TagInput.tsx`.

---

### Task 1: Create HotwordTag component

**Files:**

- Create: `src/components/settings/hotword/HotwordTag.tsx`

**Step 1: Create the component**

This is a single clickable tag/chip representing one hotword. It shows the target word as a colored Badge, with hover tooltip showing variant count + use count.

```tsx
// HotwordTag - Single clickable tag for a hotword

import { Badge, Tooltip } from "@radix-ui/themes";
import React from "react";
import type { Hotword, HotwordCategory } from "../../../types/hotword";

const CATEGORY_COLORS: Record<
  HotwordCategory,
  "green" | "orange" | "blue" | "purple"
> = {
  person: "green",
  term: "orange",
  brand: "blue",
  abbreviation: "purple",
};

interface HotwordTagProps {
  hotword: Hotword;
  isSelected: boolean;
  onClick: () => void;
}

export const HotwordTag: React.FC<HotwordTagProps> = ({
  hotword,
  isSelected,
  onClick,
}) => {
  const color = CATEGORY_COLORS[hotword.category];
  const tooltipContent = [
    hotword.originals.length > 0 && `变体: ${hotword.originals.length}`,
    `使用: ${hotword.use_count}次`,
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <Tooltip content={tooltipContent}>
      <Badge
        size="2"
        variant={isSelected ? "solid" : "soft"}
        color={color}
        className={`px-3 py-1.5 cursor-pointer select-none transition-all duration-150 ${
          isSelected
            ? "ring-2 ring-offset-1 ring-current"
            : "hover:brightness-95 active:scale-95"
        }`}
        onClick={onClick}
      >
        {hotword.target}
      </Badge>
    </Tooltip>
  );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors related to HotwordTag.tsx

**Step 3: Commit**

```bash
git add src/components/settings/hotword/HotwordTag.tsx
git commit -m "feat(hotword): add HotwordTag component for tag cloud"
```

---

### Task 2: Create HotwordEditPanel component

**Files:**

- Create: `src/components/settings/hotword/HotwordEditPanel.tsx`

**Step 1: Create the inline edit panel**

This panel appears below the tag cloud when a tag is selected. It replaces EditHotwordDialog with inline editing. Uses the existing TagInput component for originals editing. Auto-saves on change via debounce.

```tsx
// HotwordEditPanel - Inline edit panel for a selected hotword

import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Flex,
  RadioGroup,
  Text,
} from "@radix-ui/themes";
import { IconTrash } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
  SCENARIO_LABELS,
} from "../../../types/hotword";
import { TagInput } from "../post-processing/prompts/components/TagInput";

interface HotwordEditPanelProps {
  hotword: Hotword;
  onUpdate: () => void;
  onDelete: (id: number) => void;
}

export const HotwordEditPanel: React.FC<HotwordEditPanelProps> = ({
  hotword,
  onUpdate,
  onDelete,
}) => {
  const [originals, setOriginals] = useState<string[]>(hotword.originals);
  const [category, setCategory] = useState<HotwordCategory>(hotword.category);
  const [scenarios, setScenarios] = useState<HotwordScenario[]>(
    hotword.scenarios,
  );
  const [newOriginal, setNewOriginal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when hotword changes
  useEffect(() => {
    setOriginals(hotword.originals);
    setCategory(hotword.category);
    setScenarios(hotword.scenarios);
    setNewOriginal("");
    setConfirmDelete(false);
  }, [hotword.id, hotword.originals, hotword.category, hotword.scenarios]);

  // Auto-save with debounce
  const saveChanges = useCallback(
    (
      newOriginals: string[],
      newCategory: HotwordCategory,
      newScenarios: HotwordScenario[],
    ) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await invoke("update_hotword", {
            id: hotword.id,
            originals: newOriginals,
            category: newCategory,
            scenarios: newScenarios,
          });
          onUpdate();
        } catch (e) {
          console.error("[HotwordEditPanel] Save failed:", e);
        }
      }, 500);
    },
    [hotword.id, onUpdate],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleAddOriginal = () => {
    const trimmed = newOriginal.trim();
    if (!trimmed || originals.includes(trimmed)) return;
    const next = [...originals, trimmed];
    setOriginals(next);
    setNewOriginal("");
    saveChanges(next, category, scenarios);
  };

  const handleRemoveOriginal = (tag: string) => {
    const next = originals.filter((o) => o !== tag);
    setOriginals(next);
    saveChanges(next, category, scenarios);
  };

  const handleCategoryChange = (value: string) => {
    const newCat = value as HotwordCategory;
    setCategory(newCat);
    saveChanges(originals, newCat, scenarios);
  };

  const handleScenarioToggle = (scenario: HotwordScenario) => {
    const next = scenarios.includes(scenario)
      ? scenarios.filter((s) => s !== scenario)
      : [...scenarios, scenario];
    setScenarios(next);
    saveChanges(originals, category, next);
  };

  return (
    <div className="mt-2 p-4 rounded-lg border border-gray-200 bg-white/80 animate-fade-in-up">
      <Flex direction="column" gap="3">
        {/* Originals */}
        <Flex direction="column" gap="1">
          <Text size="1" color="gray" weight="medium">
            原始变体
          </Text>
          <TagInput
            tags={originals}
            inputValue={newOriginal}
            onInputChange={setNewOriginal}
            onAdd={handleAddOriginal}
            onRemove={handleRemoveOriginal}
            onKeyDown={() => {}}
            placeholder="添加变体..."
            emptyMessage="无变体"
            color="gray"
            compact
          />
        </Flex>

        {/* Category + Scenarios on one line */}
        <Flex gap="4" align="center" wrap="wrap">
          <Flex gap="1" align="center">
            <Text size="1" color="gray" weight="medium" className="mr-1">
              类别:
            </Text>
            <RadioGroup.Root
              value={category}
              onValueChange={handleCategoryChange}
            >
              <Flex gap="2">
                {(
                  Object.entries(CATEGORY_LABELS) as [HotwordCategory, string][]
                ).map(([key, label]) => (
                  <Flex key={key} align="center" gap="1">
                    <RadioGroup.Item
                      value={key}
                      id={`edit-${hotword.id}-${key}`}
                    />
                    <Text
                      as="label"
                      htmlFor={`edit-${hotword.id}-${key}`}
                      size="1"
                    >
                      {CATEGORY_ICONS[key]} {label}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </RadioGroup.Root>
          </Flex>

          <Flex gap="1" align="center">
            <Text size="1" color="gray" weight="medium" className="mr-1">
              场景:
            </Text>
            {(
              Object.entries(SCENARIO_LABELS) as [HotwordScenario, string][]
            ).map(([key, label]) => (
              <Flex key={key} align="center" gap="1">
                <Checkbox
                  size="1"
                  checked={scenarios.includes(key)}
                  onCheckedChange={() => handleScenarioToggle(key)}
                  id={`scenario-${hotword.id}-${key}`}
                />
                <Text
                  as="label"
                  htmlFor={`scenario-${hotword.id}-${key}`}
                  size="1"
                >
                  {label}
                </Text>
              </Flex>
            ))}
          </Flex>
        </Flex>

        {/* Stats + Delete */}
        <Flex justify="between" align="center">
          <Flex gap="3" align="center">
            <Text size="1" color="gray">
              使用 {hotword.use_count} 次
            </Text>
            {hotword.false_positive_count > 0 && (
              <Text size="1" color="red">
                误报 {hotword.false_positive_count} 次
              </Text>
            )}
          </Flex>
          <Button
            size="1"
            variant="soft"
            color="red"
            onClick={() => setConfirmDelete(true)}
          >
            <IconTrash size={12} />
            删除
          </Button>
        </Flex>
      </Flex>

      {/* Delete Confirmation */}
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
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors related to HotwordEditPanel.tsx

**Step 3: Commit**

```bash
git add src/components/settings/hotword/HotwordEditPanel.tsx
git commit -m "feat(hotword): add HotwordEditPanel for inline editing"
```

---

### Task 3: Create HotwordAddBar component

**Files:**

- Create: `src/components/settings/hotword/HotwordAddBar.tsx`

**Step 1: Create the inline add bar**

Replaces AddHotwordDialog and BatchAddDialog. Shows an inline input that supports comma-separated batch input. Auto-infers category per word.

```tsx
// HotwordAddBar - Inline add bar for adding hotwords

import { Badge, Button, Flex, Text, TextField } from "@radix-ui/themes";
import { IconPlus } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useState } from "react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
} from "../../../types/hotword";

interface HotwordAddBarProps {
  onAdd: (
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => Promise<void>;
  onBatchAdd: (targets: string[]) => Promise<void>;
}

export const HotwordAddBar: React.FC<HotwordAddBarProps> = ({
  onAdd,
  onBatchAdd,
}) => {
  const [input, setInput] = useState("");
  const [inferredCategory, setInferredCategory] =
    useState<HotwordCategory | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Parse input: if contains comma or newline, treat as batch
  const targets = input
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const isBatch = targets.length > 1;

  // Auto-infer category for single word
  const handleInputChange = (value: string) => {
    setInput(value);
    const parsed = value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length === 1 && parsed[0].length > 0) {
      const timeout = setTimeout(async () => {
        try {
          const [cat] = await invoke<[HotwordCategory, number]>(
            "infer_hotword_category",
            { target: parsed[0] },
          );
          setInferredCategory(cat);
        } catch {
          setInferredCategory(null);
        }
      }, 300);
      return () => clearTimeout(timeout);
    } else {
      setInferredCategory(null);
    }
  };

  const handleSubmit = async () => {
    if (targets.length === 0) return;
    setIsSubmitting(true);
    try {
      if (isBatch) {
        await onBatchAdd(targets);
      } else {
        await onAdd(targets[0], [], inferredCategory || "term", [
          "work",
          "casual",
        ]);
      }
      setInput("");
      setInferredCategory(null);
    } catch (e) {
      console.error("[HotwordAddBar] Add failed:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && targets.length > 0) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/50 animate-fade-in-down">
      <Flex gap="2" align="center">
        <TextField.Root
          className="flex-1"
          size="2"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入热词（逗号分隔可批量添加）..."
        />
        {inferredCategory && !isBatch && (
          <Badge size="1" variant="soft" color="gray">
            {CATEGORY_ICONS[inferredCategory]}{" "}
            {CATEGORY_LABELS[inferredCategory]}
          </Badge>
        )}
        {isBatch && (
          <Text size="1" color="gray">
            {targets.length} 个词
          </Text>
        )}
        <Button
          size="2"
          onClick={handleSubmit}
          disabled={targets.length === 0 || isSubmitting}
        >
          <IconPlus size={14} />
          {isBatch ? `添加 (${targets.length})` : "添加"}
        </Button>
      </Flex>
    </div>
  );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/settings/hotword/HotwordAddBar.tsx
git commit -m "feat(hotword): add HotwordAddBar for inline adding"
```

---

### Task 4: Create HotwordTagCloud component

**Files:**

- Create: `src/components/settings/hotword/HotwordTagCloud.tsx`

**Step 1: Create the main tag cloud view**

This is the main component that replaces HotwordTable. It renders:

1. Toolbar (add toggle, import, export, search)
2. AI suggestions banner (compact tag row)
3. Inline add bar (when toggled)
4. Category groups with tags
5. Inline edit panel (when tag selected)

```tsx
// HotwordTagCloud - Main tag cloud view for hotwords

import {
  Badge,
  Box,
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
import React, { useMemo, useState } from "react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
} from "../../../types/hotword";
import { HotwordAddBar } from "./HotwordAddBar";
import { HotwordEditPanel } from "./HotwordEditPanel";
import { HotwordTag } from "./HotwordTag";

const CATEGORY_COLORS: Record<
  HotwordCategory,
  "green" | "orange" | "blue" | "purple"
> = {
  person: "green",
  term: "orange",
  brand: "blue",
  abbreviation: "purple",
};

const CATEGORY_ORDER: HotwordCategory[] = [
  "person",
  "term",
  "brand",
  "abbreviation",
];

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
  onReload: () => void;
  onAcceptSuggestion: (id: number) => void;
  onDismissSuggestion: (id: number) => void;
  onAcceptAll: () => void;
  onDismissAll: () => void;
  onImport: () => void;
  onExport: () => void;
}

export const HotwordTagCloud: React.FC<HotwordTagCloudProps> = ({
  hotwords,
  suggestions,
  loading,
  onAddHotword,
  onBatchAdd,
  onDelete,
  onReload,
  onAcceptSuggestion,
  onDismissSuggestion,
  onAcceptAll,
  onDismissAll,
  onImport,
  onExport,
}) => {
  const [search, setSearch] = useState("");
  const [showAddBar, setShowAddBar] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<HotwordCategory, Hotword[]> = {
      person: [],
      term: [],
      brand: [],
      abbreviation: [],
    };
    filteredHotwords.forEach((h) => {
      if (groups[h.category]) {
        groups[h.category].push(h);
      }
    });
    return groups;
  }, [filteredHotwords]);

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
                  {suggestions.map((s) => (
                    <Badge
                      key={s.id}
                      size="2"
                      variant="outline"
                      color={CATEGORY_COLORS[s.category]}
                      className="px-2 py-1 cursor-pointer hover:brightness-95 transition-all duration-150 group"
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
                  ))}
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

          {/* Category Groups */}
          {!loading &&
            CATEGORY_ORDER.map((cat) => {
              const items = grouped[cat];
              if (items.length === 0) return null;

              return (
                <div
                  key={cat}
                  className="rounded-lg border border-gray-200 bg-white/60 p-3"
                >
                  <Text
                    size="1"
                    weight="medium"
                    color="gray"
                    className="mb-2 block"
                  >
                    {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]} ({items.length}
                    )
                  </Text>
                  <Flex wrap="wrap" gap="2">
                    {items.map((h) => (
                      <HotwordTag
                        key={h.id}
                        hotword={h}
                        isSelected={selectedId === h.id}
                        onClick={() => handleTagClick(h.id)}
                      />
                    ))}
                  </Flex>
                  {/* Inline edit panel for selected hotword in this group */}
                  {selectedHotword && selectedHotword.category === cat && (
                    <HotwordEditPanel
                      hotword={selectedHotword}
                      onUpdate={onReload}
                      onDelete={handleDelete}
                    />
                  )}
                </div>
              );
            })}
        </Flex>
      </div>
    </Flex>
  );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/settings/hotword/HotwordTagCloud.tsx
git commit -m "feat(hotword): add HotwordTagCloud main view component"
```

---

### Task 5: Rewire HotwordSettings to use TagCloud

**Files:**

- Modify: `src/components/settings/hotword/HotwordSettings.tsx`

**Step 1: Replace HotwordTable and Dialogs with HotwordTagCloud**

Swap out the current table+dialog rendering for the new tag cloud. Keep all data logic (loading, handlers). Remove imports for HotwordTable, AddHotwordDialog, BatchAddDialog, EditHotwordDialog. The delete confirmation is now inside HotwordEditPanel, so remove it from HotwordSettings too.

Replace the entire file content with:

```tsx
// HotwordSettings - Main component for managing hotwords

import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Hotword,
  HotwordCategory,
  HotwordScenario,
} from "../../../types/hotword";
import { HotwordTagCloud } from "./HotwordTagCloud";

export const HotwordSettings: React.FC = () => {
  const [hotwords, setHotwords] = useState<Hotword[]>([]);
  const [suggestions, setSuggestions] = useState<Hotword[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHotwords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Hotword[]>("get_hotwords");
      setHotwords(result.filter((h) => h.status === "active"));
    } catch (e) {
      console.error("[HotwordSettings] Failed to load hotwords:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    try {
      const result = await invoke<Hotword[]>("get_hotword_suggestions");
      setSuggestions(result);
    } catch (e) {
      console.error("[HotwordSettings] Failed to load suggestions:", e);
    }
  }, []);

  useEffect(() => {
    loadHotwords();
    loadSuggestions();
  }, [loadHotwords, loadSuggestions]);

  // Add hotword
  const handleAdd = async (
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

  // Batch add
  const handleBatchAdd = async (targets: string[]) => {
    for (const target of targets) {
      try {
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

  // Delete
  const handleDelete = async (id: number) => {
    try {
      await invoke("delete_hotword", { id });
      setHotwords((prev) => prev.filter((h) => h.id !== id));
    } catch (e) {
      console.error("[HotwordSettings] Failed to delete:", e);
    }
  };

  // Suggestion handlers
  const handleAcceptSuggestion = async (id: number) => {
    try {
      await invoke("accept_hotword_suggestion", { id });
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      await loadHotwords();
    } catch (e) {
      console.error("[HotwordSettings] Failed to accept suggestion:", e);
    }
  };

  const handleDismissSuggestion = async (id: number) => {
    try {
      await invoke("dismiss_hotword_suggestion", { id });
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("[HotwordSettings] Failed to dismiss suggestion:", e);
    }
  };

  const handleAcceptAll = async () => {
    try {
      await invoke("accept_all_hotword_suggestions");
      setSuggestions([]);
      await loadHotwords();
    } catch (e) {
      console.error("[HotwordSettings] Failed to accept all:", e);
    }
  };

  const handleDismissAll = async () => {
    try {
      await invoke("dismiss_all_hotword_suggestions");
      setSuggestions([]);
    } catch (e) {
      console.error("[HotwordSettings] Failed to dismiss all:", e);
    }
  };

  // Export
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

  // Import
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

        if (Array.isArray(imported)) {
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

  return (
    <HotwordTagCloud
      hotwords={hotwords}
      suggestions={suggestions}
      loading={loading}
      onAddHotword={handleAdd}
      onBatchAdd={handleBatchAdd}
      onDelete={handleDelete}
      onReload={loadHotwords}
      onAcceptSuggestion={handleAcceptSuggestion}
      onDismissSuggestion={handleDismissSuggestion}
      onAcceptAll={handleAcceptAll}
      onDismissAll={handleDismissAll}
      onImport={handleImport}
      onExport={handleExport}
    />
  );
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/settings/hotword/HotwordSettings.tsx
git commit -m "refactor(hotword): rewire HotwordSettings to use TagCloud"
```

---

### Task 6: Delete old Dialog and Table components

**Files:**

- Delete: `src/components/settings/hotword/HotwordTable.tsx`
- Delete: `src/components/settings/hotword/EditHotwordDialog.tsx`
- Delete: `src/components/settings/hotword/AddHotwordDialog.tsx`
- Delete: `src/components/settings/hotword/BatchAddDialog.tsx`

**Step 1: Delete the files**

```bash
rm src/components/settings/hotword/HotwordTable.tsx
rm src/components/settings/hotword/EditHotwordDialog.tsx
rm src/components/settings/hotword/AddHotwordDialog.tsx
rm src/components/settings/hotword/BatchAddDialog.tsx
```

**Step 2: Verify no imports reference deleted files**

Run: `grep -r "HotwordTable\|AddHotwordDialog\|EditHotwordDialog\|BatchAddDialog" src/ --include="*.tsx" --include="*.ts"`
Expected: No matches (all imports were removed in Task 5)

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add -u src/components/settings/hotword/
git commit -m "refactor(hotword): remove old table and dialog components"
```

---

### Task 7: Update VocabularySettings wrapper

**Files:**

- Modify: `src/components/settings/VocabularySettings.tsx`

**Step 1: Fix the Card wrapper**

Currently VocabularySettings wraps both tabs in a `<Card>`. The corrections tab uses the Card properly (flex column with header + scrollable body). HotwordSettings (now HotwordTagCloud) has its own internal layout. We need to ensure HotwordSettings fills the Card properly.

In `src/components/settings/VocabularySettings.tsx`, change the hotwords tab render from:

```tsx
{
  activeTab === "hotwords" && <HotwordSettings />;
}
```

To:

```tsx
{
  activeTab === "hotwords" && (
    <div className="animate-fade-in-up">
      <HotwordSettings />
    </div>
  );
}
```

This adds the same fade-in animation that the corrections tab has.

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/settings/VocabularySettings.tsx
git commit -m "fix(hotword): add fade-in animation to hotwords tab"
```

---

### Task 8: Build verification and visual review

**Step 1: Verify Rust backend builds**

Run: `cd /Users/zac/code/github/asr/Handy && cargo build 2>&1 | tail -5`
Expected: Successful build (backend unchanged, should still pass)

**Step 2: Verify frontend TypeScript**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit`
Expected: No errors

**Step 3: Verify frontend builds**

Run: `cd /Users/zac/code/github/asr/Handy && bun build`
Expected: Successful build

**Step 4: Verify no unused imports in new files**

Run: `grep -n "^import" src/components/settings/hotword/Hotword*.tsx`
Manually verify all imports are used.

**Step 5: Final commit if any fixes needed**

If any issues found in steps 1-4, fix them and commit.
