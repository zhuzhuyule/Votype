// ReviewWindow - Independent window for reviewing low-confidence transcriptions
// This provides a floating window UI for editing and inserting transcribed text

import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CancelIcon } from "../components/icons";
import "./ReviewWindow.css";

interface ReviewData {
  text: string;
  confidence: number;
  history_id: number | null;
  reason?: string[] | null;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");
  const insertShortcut = isMac ? "⌘⏎" : "Ctrl⏎";

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: t(
            "transcription.review.placeholder",
            "Edit transcription...",
          ),
        }),
      ],
      content: initialData.text,
      editorProps: {
        attributes: {
          class: "review-editor",
        },
      },
    },
    [t],
  );

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(initialData.text, false);
  }, [editor, initialData.text]);

  useEffect(() => {
    if (!editor) return;
    setTimeout(() => {
      editor.commands.focus("end");
    }, 50);
  }, [editor]);

  const getEditorText = useCallback(() => {
    if (!editor) return "";
    return editor.getText({ blockSeparator: "\n" });
  }, [editor]);

  const handleInsert = useCallback(async () => {
    const currentText = getEditorText();
    if (isSubmitting || !currentText.trim()) return;

    setIsSubmitting(true);
    try {
      await invoke("confirm_reviewed_transcription", {
        text: currentText.trim(),
        history_id: initialData.history_id,
      });
      onClose();
    } catch (e) {
      console.error("Failed to insert reviewed text:", e);
    } finally {
      setIsSubmitting(false);
    }
  }, [getEditorText, initialData.history_id, onClose, isSubmitting]);

  const reasonItems = (initialData.reason ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  const reasonList =
    reasonItems.length > 0 ? reasonItems : ["需要关注：请检查语句通顺性。"];

  const handleCancel = useCallback(() => {
    if (isSubmitting) return;

    const trimmed = getEditorText().trim();
    const historyId = initialData.history_id;
    onClose();

    void (async () => {
      try {
        await invoke("cancel_transcription_review", {
          text: trimmed.length > 0 ? trimmed : null,
          history_id: historyId,
        });
      } catch (e) {
        console.error("Failed to cancel review:", e);
      }
    })();
  }, [onClose, isSubmitting, initialData.history_id, getEditorText]);

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
              className="review-tooltip review-tooltip-bottom"
              data-tooltip="按 ESC 也可关闭"
            >
              <div
                className="review-close-button w-6 h-6 flex items-center justify-center rounded-[6px] cursor-pointer text-[var(--gray-10)] transition-all duration-200 hover:bg-[var(--gray-4)] hover:text-[var(--gray-12)]"
                onClick={handleCancel}
              >
                <CancelIcon />
              </div>
            </div>
          </Flex>
        </div>

        {/* Editable textarea */}
        <div className="flex-1 p-3 flex flex-col min-h-0">
          <EditorContent
            editor={editor}
            onKeyDown={handleKeyDown}
            className="flex-1 min-h-0"
          />
        </div>

        {/* Footer with hint and insert button */}
        <Flex
          justify="between"
          align="center"
          className="px-3.5 py-2.5 border-t border-[var(--gray-4)] bg-[var(--gray-1)]"
        >
          <div className="flex flex-col gap-0.5">
            <ol className="review-reason-list">
              {reasonList.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ol>
          </div>
          <Flex align="center" gap="2">
            <div
              className="review-tooltip review-tooltip-top"
              data-tooltip={t(
                "transcription.review.insertStabilityHint",
                `快捷键：${insertShortcut}\n如果插入不稳定，可暂时关闭该功能。`,
              )}
            >
              <Button
                variant="classic"
                size="2"
                onClick={handleInsert}
                disabled={isSubmitting || !getEditorText().trim()}
                data-tauri-drag-region="false"
              >
                {t("transcription.review.insert", "Insert")}
              </Button>
            </div>
          </Flex>
        </Flex>
      </div>
    </div>
  );
};

export default ReviewWindow;
