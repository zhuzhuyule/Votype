// AddHotwordDialog - Dialog for adding a single hotword

import {
  Button,
  Checkbox,
  Dialog,
  Flex,
  RadioGroup,
  Text,
  TextField,
} from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  type HotwordCategory,
  type HotwordScenario,
  SCENARIO_LABELS,
} from "../../../types/hotword";

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

export const AddHotwordDialog: React.FC<AddHotwordDialogProps> = ({
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
