// HotwordEditPanel - Inline edit panel for a selected hotword

import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Flex,
  IconButton,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconAbc,
  IconBuildingStore,
  IconCheck,
  IconTrash,
  IconUser,
  IconVocabulary,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
  SCENARIO_LABELS,
  SOURCE_LABELS,
} from "../../../types/hotword";
import { TagInput } from "../post-processing/prompts/components/TagInput";

const CATEGORY_ICON_COMPONENTS: Record<HotwordCategory, typeof IconUser> = {
  person: IconUser,
  term: IconVocabulary,
  brand: IconBuildingStore,
  abbreviation: IconAbc,
};

const CATEGORY_COLORS: Record<
  HotwordCategory,
  "green" | "orange" | "blue" | "purple"
> = {
  person: "green",
  term: "orange",
  brand: "blue",
  abbreviation: "purple",
};

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
  const [target, setTarget] = useState(hotword.target);
  const [originals, setOriginals] = useState<string[]>(hotword.originals);
  const [category, setCategory] = useState<HotwordCategory>(hotword.category);
  const [scenarios, setScenarios] = useState<HotwordScenario[]>(
    hotword.scenarios,
  );
  const [newOriginal, setNewOriginal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTarget(hotword.target);
    setOriginals(hotword.originals);
    setCategory(hotword.category);
    setScenarios(hotword.scenarios);
    setNewOriginal("");
    setConfirmDelete(false);
  }, [
    hotword.id,
    hotword.target,
    hotword.originals,
    hotword.category,
    hotword.scenarios,
  ]);

  const hasChanges = useMemo(() => {
    if (target.trim() !== hotword.target) return true;
    if (category !== hotword.category) return true;
    if (JSON.stringify(originals) !== JSON.stringify(hotword.originals))
      return true;
    if (JSON.stringify(scenarios) !== JSON.stringify(hotword.scenarios))
      return true;
    return false;
  }, [target, originals, category, scenarios, hotword]);

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

  const handleAddOriginal = () => {
    const trimmed = newOriginal.trim();
    if (!trimmed || originals.includes(trimmed)) return;
    setOriginals((prev) => [...prev, trimmed]);
    setNewOriginal("");
  };

  const handleRemoveOriginal = (tag: string) => {
    setOriginals((prev) => prev.filter((o) => o !== tag));
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

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white animate-fade-in-up overflow-hidden">
      {/* Header row: target input + meta + actions */}
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
            <Text size="1" color="gray">
              使用 {hotword.use_count} 次
            </Text>
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

      {/* Body: category chips + scenarios + variants */}
      <div className="px-4 py-3">
        <Flex direction="column" gap="3">
          {/* Category as selectable chips */}
          <Flex gap="2" align="center">
            <Text
              size="1"
              color="gray"
              weight="medium"
              className="shrink-0 w-10"
            >
              类别
            </Text>
            <Flex gap="1" wrap="wrap">
              {(
                Object.entries(CATEGORY_LABELS) as [HotwordCategory, string][]
              ).map(([key, label]) => {
                const Icon = CATEGORY_ICON_COMPONENTS[key];
                const isActive = category === key;
                return (
                  <Badge
                    key={key}
                    size="1"
                    variant={isActive ? "solid" : "outline"}
                    color={CATEGORY_COLORS[key]}
                    className={`px-2 py-0.5 cursor-pointer select-none transition-all duration-100 ${
                      isActive ? "" : "opacity-50 hover:opacity-80"
                    }`}
                    onClick={() => setCategory(key)}
                  >
                    <Flex align="center" gap="1">
                      <Icon size={11} />
                      {label}
                    </Flex>
                  </Badge>
                );
              })}
            </Flex>
          </Flex>

          {/* Scenarios as toggleable chips */}
          <Flex gap="2" align="center">
            <Text
              size="1"
              color="gray"
              weight="medium"
              className="shrink-0 w-10"
            >
              场景
            </Text>
            <Flex gap="1">
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
                    className={`px-2 py-0.5 cursor-pointer select-none transition-all duration-100 ${
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

          {/* Originals - common misrecognitions to correct */}
          <Flex gap="2" align="start">
            <Tooltip content="语音识别中常见的错误写法，会被自动纠正为目标词">
              <Text
                size="1"
                color="gray"
                weight="medium"
                className="shrink-0 w-10 pt-1 cursor-help border-b border-dashed border-gray-300"
              >
                纠错
              </Text>
            </Tooltip>
            <div className="flex-1">
              <TagInput
                tags={originals}
                inputValue={newOriginal}
                onInputChange={setNewOriginal}
                onAdd={handleAddOriginal}
                onRemove={handleRemoveOriginal}
                onKeyDown={() => {}}
                placeholder="添加易错写法，如「张含」→「张晗」"
                emptyMessage="无纠错项"
                color="gray"
                compact
              />
            </div>
          </Flex>
        </Flex>
      </div>

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
