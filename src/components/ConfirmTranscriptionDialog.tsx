// ConfirmTranscriptionDialog - Dialog for reviewing low-confidence transcriptions
// This dialog is shown when the LLM's confidence in the transcription is below the threshold

import { AlertDialog, Badge, Box, Button, Flex, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface TranscriptionReviewData {
  text: string;
  confidence: number;
  history_id: number | null;
}

interface ConfirmTranscriptionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reviewData: TranscriptionReviewData | null;
}

export const ConfirmTranscriptionDialog: React.FC<
  ConfirmTranscriptionDialogProps
> = ({ isOpen, onClose, reviewData }) => {
  const { t } = useTranslation();
  const [editedText, setEditedText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync edited text when review data changes
  useEffect(() => {
    if (reviewData) {
      setEditedText(reviewData.text);
    }
  }, [reviewData]);

  const handleConfirm = useCallback(async () => {
    if (!reviewData || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await invoke("confirm_reviewed_transcription", {
        text: editedText.trim(),
        history_id: reviewData.history_id,
      });
      onClose();
    } catch (e) {
      console.error("Failed to confirm transcription:", e);
    } finally {
      setIsSubmitting(false);
    }
  }, [editedText, reviewData, onClose, isSubmitting]);

  const handleCancel = useCallback(async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const trimmed = editedText.trim();
      await invoke("cancel_transcription_review", {
        text: trimmed.length > 0 ? trimmed : null,
        history_id: reviewData?.history_id ?? null,
      });
      onClose();
    } catch (e) {
      console.error("Failed to cancel transcription review:", e);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [onClose, isSubmitting, editedText, reviewData?.history_id]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Enter to confirm
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      }
      // Escape to cancel
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleConfirm, handleCancel]);

  const getConfidenceBadgeColor = (
    confidence: number,
  ): "red" | "orange" | "yellow" | "green" => {
    if (confidence < 50) return "red";
    if (confidence < 70) return "orange";
    if (confidence < 85) return "yellow";
    return "green";
  };

  if (!reviewData) return null;

  return (
    <AlertDialog.Root
      open={isOpen}
      onOpenChange={(open) => !open && handleCancel()}
    >
      <AlertDialog.Content maxWidth="500px" style={{ maxHeight: "80vh" }}>
        <AlertDialog.Title>
          {t("transcription.review.title", "Review Transcription")}
        </AlertDialog.Title>

        <AlertDialog.Description size="2">
          <Flex align="center" gap="2" mb="2">
            <Text size="2" color="gray">
              {t("transcription.review.confidence", "Confidence")}:
            </Text>
            <Badge
              color={getConfidenceBadgeColor(reviewData.confidence)}
              size="1"
            >
              {reviewData.confidence}%
            </Badge>
          </Flex>
          <Text size="2" color="gray">
            {t(
              "transcription.review.description",
              "The transcription may contain errors. Please review and edit if needed.",
            )}
          </Text>
        </AlertDialog.Description>

        <Box mt="3">
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            style={{
              width: "100%",
              minHeight: "120px",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid var(--gray-6)",
              backgroundColor: "var(--gray-2)",
              color: "var(--gray-12)",
              fontSize: "14px",
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
            }}
            placeholder={t(
              "transcription.review.placeholder",
              "Edit the transcription here...",
            )}
            autoFocus
          />
        </Box>

        <Flex gap="3" mt="4" justify="between" align="center">
          <Text size="1" color="gray">
            {t(
              "transcription.review.hint",
              "⌘/Ctrl + Enter to confirm, Escape to cancel",
            )}
          </Text>
          <Flex gap="2">
            <Button
              variant="soft"
              color="gray"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="solid"
              color="blue"
              onClick={handleConfirm}
              disabled={isSubmitting || !editedText.trim()}
            >
              {t("transcription.review.confirm", "Confirm & Insert")}
            </Button>
          </Flex>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
};
