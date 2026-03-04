// BatchAddDialog - Dialog for batch adding multiple hotwords

import { Button, Dialog, Flex, Text, TextArea } from "@radix-ui/themes";
import React, { useState } from "react";

interface BatchAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBatchAdd: (targets: string[]) => Promise<void>;
}

export const BatchAddDialog: React.FC<BatchAddDialogProps> = ({
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
