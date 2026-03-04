// EditHotwordDialog - Dialog for editing an existing hotword

import {
  Button,
  Checkbox,
  Dialog,
  Flex,
  RadioGroup,
  Text,
  TextField,
} from "@radix-ui/themes";
import React, { useEffect, useState } from "react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
  SCENARIO_LABELS,
} from "../../../types/hotword";

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

export const EditHotwordDialog: React.FC<EditHotwordDialogProps> = ({
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
