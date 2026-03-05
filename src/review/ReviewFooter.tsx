// Bottom action bar for review window

import { IconCopy } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

interface ReviewFooterProps {
  reason?: string | null;
  outputMode?: "polish" | "chat";
  isSubmitting: boolean;
  hasText: boolean;
  insertShortcut: string;
  isMultiModel?: boolean;
  onCopy: () => void;
  onInsert: () => void;
}

export const ReviewFooter: React.FC<ReviewFooterProps> = ({
  reason,
  outputMode,
  isSubmitting,
  hasText,
  insertShortcut,
  isMultiModel,
  onCopy,
  onInsert,
}) => {
  const { t } = useTranslation();

  return (
    <div className="review-footer">
      <div className="review-footer-left">
        {reason?.trim() ? <span className="reason-text">{reason}</span> : null}
      </div>
      <div className="review-footer-actions">
        {outputMode === "chat" && (
          <button
            className="review-btn-secondary"
            onClick={onCopy}
            disabled={isSubmitting || !hasText}
          >
            <IconCopy size={14} />
            {t("common.copy", "Copy")}
          </button>
        )}
        <button
          className="review-btn-primary"
          onClick={onInsert}
          disabled={isSubmitting || !hasText}
          data-tauri-drag-region="false"
        >
          {t("transcription.review.insert", "Insert")}{" "}
          <span className="opacity-60 ml-1 font-normal">{insertShortcut}</span>
        </button>
      </div>
    </div>
  );
};
