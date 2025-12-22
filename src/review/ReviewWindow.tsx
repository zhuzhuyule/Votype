// ReviewWindow - Independent window for reviewing low-confidence transcriptions
// This provides a floating window UI for editing and inserting transcribed text

import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CancelIcon } from "../components/icons";
import "./ReviewWindow.css";

interface ReviewData {
  text: string;
  confidence: number;
  history_id: number | null;
}

interface ReviewWindowProps {
  initialData: ReviewData;
  onClose: () => void;
}

const ReviewWindow: React.FC<ReviewWindowProps> = ({
  initialData,
  onClose,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState(initialData.text);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus textarea on mount
  useEffect(() => {
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 50);
  }, []);

  // Update text when initial data changes
  useEffect(() => {
    setText(initialData.text);
  }, [initialData.text]);

  const handleInsert = useCallback(async () => {
    if (isSubmitting || !text.trim()) return;

    setIsSubmitting(true);
    try {
      await invoke("confirm_reviewed_transcription", {
        text: text.trim(),
        history_id: initialData.history_id,
      });
      onClose();
    } catch (e) {
      console.error("Failed to insert reviewed text:", e);
    } finally {
      setIsSubmitting(false);
    }
  }, [text, initialData.history_id, onClose, isSubmitting]);

  const handleCancel = useCallback(async () => {
    if (isSubmitting) return;

    try {
      const trimmed = text.trim();
      await invoke("cancel_transcription_review", {
        text: trimmed.length > 0 ? trimmed : null,
        history_id: initialData.history_id,
      });
      onClose();
    } catch (e) {
      console.error("Failed to cancel review:", e);
      onClose();
    }
  }, [onClose, isSubmitting, initialData.history_id, text]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Tab or Cmd/Ctrl+Enter to insert
      if (e.key === "Tab" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
        e.preventDefault();
        handleInsert();
      }
      // Escape to cancel
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleInsert, handleCancel],
  );

  const getConfidenceColor = (confidence: number): string => {
    if (confidence < 50) return "var(--ruby-9)";
    if (confidence < 70) return "var(--amber-9)";
    return "var(--grass-9)";
  };

  const handleDrag = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    } catch (e) {
      console.error("Failed to start dragging:", e);
    }
  }, []);

  return (
    <div className="w-screen h-screen flex items-center justify-center p-0 box-border overflow-hidden bg-transparent">
      <div
        className="w-full h-full flex flex-col bg-[var(--color-panel-solid)] relative border border-[var(--gray-5)] rounded-[12px] shadow-[var(--shadow-5)] overflow-hidden"
        style={{ animation: "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div
          className="cursor-grab select-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            // Only trigger dragging if the target (or its parent) isn't the close button
            if (!(e.target as HTMLElement).closest(".review-close-button")) {
              e.preventDefault();
              handleDrag();
            }
          }}
        >
          <Flex
            justify="between"
            align="center"
            className="px-3.5 py-3 border-b border-[var(--gray-4)] bg-[var(--gray-2)] select-none cursor-grab"
          >
            <Flex align="center" gap="2">
              <Box
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: getConfidenceColor(initialData.confidence),
                }}
              />
              <Text size="1" weight="bold" style={{ color: "var(--gray-11)" }}>
                {t("transcription.review.confidence", "Confidence")}:{" "}
                {initialData.confidence}%
              </Text>
            </Flex>
            <div
              className="review-close-button w-6 h-6 flex items-center justify-center rounded-[6px] cursor-pointer text-[var(--gray-10)] transition-all duration-200 hover:bg-[var(--gray-4)] hover:text-[var(--gray-12)]"
              onClick={handleCancel}
            >
              <CancelIcon />
            </div>
          </Flex>
        </div>

        {/* Editable textarea */}
        <div className="flex-1 p-3 flex flex-col min-h-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 w-full border-none bg-transparent text-[var(--gray-12)] text-[14px] leading-[1.6] resize-none outline-none font-inherit p-0"
            placeholder={t(
              "transcription.review.placeholder",
              "Edit transcription...",
            )}
          />
        </div>

        {/* Footer with hint and insert button */}
        <Flex
          justify="between"
          align="center"
          className="px-3.5 py-2.5 border-t border-[var(--gray-4)] bg-[var(--gray-1)]"
        >
          <div className="flex flex-col gap-0.5">
            <Text size="1" className="text-[var(--gray-9)] text-[11px]">
              {t("transcription.review.hint", "Tab to insert, Esc to cancel")}
            </Text>
            <Text size="1" className="text-[var(--gray-9)] text-[11px]">
              {t(
                "transcription.review.insertStabilityHint",
                "If insertion is unstable, disable this feature temporarily.",
              )}
            </Text>
          </div>
          <Button
            variant="classic"
            size="2"
            onClick={handleInsert}
            disabled={isSubmitting || !text.trim()}
            data-tauri-drag-region="false"
          >
            {t("transcription.review.insert", "Insert")}
          </Button>
        </Flex>
      </div>
    </div>
  );
};

export default ReviewWindow;
