// EditHistoryDialog - Dialog for editing history entry text

import { Button, Dialog, Flex, Text, TextArea } from "@radix-ui/themes";
import { IconPencil } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export type EditableField =
  | "transcription_text"
  | "streaming_text"
  | "post_processed_text"
  | "post_process_history_step";

interface EditHistoryDialogProps {
  entryId: number;
  field: EditableField;
  initialText: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** Required when field is "post_process_history_step" */
  stepIndex?: number;
  /** Optional label for the step (e.g., prompt name) */
  stepLabel?: string;
  /** App name for scoping vocabulary corrections */
  appName?: string;
}

export const EditHistoryDialog: React.FC<EditHistoryDialogProps> = ({
  entryId,
  field,
  initialText,
  isOpen,
  onOpenChange,
  onSaved,
  stepIndex,
  stepLabel,
  appName,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset text when dialog opens or initialText changes
  useEffect(() => {
    if (isOpen) {
      setText(initialText);
      setError(null);
    }
  }, [isOpen, initialText]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    // Auto-learn corrections
    try {
      const { extractCorrections } = await import(
        "../../../lib/correctionUtils"
      );
      const corrections = extractCorrections(initialText, text);
      if (corrections.length > 0) {
        console.log(
          "[EditHistoryDialog] Auto-learning corrections:",
          corrections,
        );
        for (const c of corrections) {
          invoke("record_vocabulary_correction", {
            original_text: c.original,
            corrected_text: c.corrected,
            app_name: appName || null,
          }).catch((err) =>
            console.warn("Failed to learn correction:", c, err),
          );
        }
      }
    } catch (e) {
      console.warn("Error in correction learning:", e);
    }

    try {
      await invoke("update_history_entry_text", {
        id: entryId,
        field,
        text,
        stepIndex: field === "post_process_history_step" ? stepIndex : null,
        appName: appName || null,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      console.error("[EditHistoryDialog] Save failed:", e);
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [
    entryId,
    field,
    text,
    saving,
    onOpenChange,
    onSaved,
    stepIndex,
    appName,
    initialText,
  ]);

  const fieldLabel =
    field === "transcription_text"
      ? t("settings.history.content.original")
      : field === "streaming_text"
        ? t("settings.history.content.streaming")
        : field === "post_process_history_step"
          ? stepLabel || t("settings.history.content.chained")
          : t("settings.history.content.improved");

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 800 }}>
        <Dialog.Title>{t("dashboard.actions.editTitle")}</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          {t("dashboard.actions.editDescription")} ({fieldLabel})
        </Dialog.Description>

        <Flex direction="column" gap="3">
          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("dashboard.actions.editPlaceholder")}
            rows={20}
            style={{ fontFamily: "monospace", fontSize: "13px" }}
          />

          {error && (
            <Text color="red" size="2">
              {error}
            </Text>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              {t("common.cancel")}
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={saving || text === initialText}
          >
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

// Trigger button component for convenience
interface EditButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const EditButton: React.FC<EditButtonProps> = ({
  onClick,
  disabled = false,
}) => {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="1"
      onClick={onClick}
      disabled={disabled}
      className="text-text/40 hover:text-text/80 transition-colors"
    >
      <IconPencil size={14} />
      <Text size="1">{t("dashboard.actions.edit")}</Text>
    </Button>
  );
};
