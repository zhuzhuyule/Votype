// HotwordAddBar - Inline add bar for adding hotwords

import { Badge, Button, Flex, Text, TextField } from "@radix-ui/themes";
import { IconPlus } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useState } from "react";
import type {
  HotwordCategory,
  HotwordCategoryMeta,
  HotwordScenario,
} from "../../../types/hotword";
import { resolveIcon } from "../../../lib/hotwordIcons";

interface HotwordAddBarProps {
  onAdd: (
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => Promise<void>;
  onBatchAdd: (targets: string[]) => Promise<void>;
  categoryMap: Record<string, HotwordCategoryMeta>;
}

export const HotwordAddBar: React.FC<HotwordAddBarProps> = ({
  onAdd,
  onBatchAdd,
  categoryMap,
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
          const cat = await invoke<HotwordCategory>("infer_hotword_category", {
            target: parsed[0],
          });
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

  const inferredMeta = inferredCategory ? categoryMap[inferredCategory] : null;

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
        {inferredMeta && !isBatch && (
          <Badge size="1" variant="soft" color="gray">
            {React.createElement(resolveIcon(inferredMeta.icon), {
              size: 12,
            })}{" "}
            {inferredMeta.label}
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
