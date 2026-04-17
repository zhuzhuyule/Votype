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
  /** Hide the primary Insert button — set when the DiffViewPanel provides an
   *  inline Insert affordance and the footer would otherwise duplicate it. */
  hidePrimaryInsert?: boolean;
  onCopy: () => void;
  onInsert: () => void;
}

export const ReviewFooter: React.FC<ReviewFooterProps> = ({
  reason,
  outputMode,
  isSubmitting,
  hasText,
  insertShortcut,
  hidePrimaryInsert,
  onCopy,
  onInsert,
}) => {
  const { t } = useTranslation();

  const hasReason = !!reason?.trim();
  const hasCopy = outputMode === "chat";
  const hasInsert = !hidePrimaryInsert;

  // Footer renders nothing when all its content has been migrated into the
  // content area — avoids an empty border strip below the editor.
  if (!hasReason && !hasCopy && !hasInsert) {
    return null;
  }

  return (
    <div className="review-footer">
      <div className="review-footer-left">
        {hasReason ? <span className="reason-text">{reason}</span> : null}
      </div>
      <div className="review-footer-actions">
        {hasCopy && (
          <button
            className="review-btn-secondary"
            onClick={onCopy}
            disabled={isSubmitting || !hasText}
          >
            <IconCopy size={14} />
            {t("common.copy", "Copy")}
          </button>
        )}
        {hasInsert && (
          <button
            className="review-btn-primary"
            onClick={onInsert}
            disabled={isSubmitting || !hasText}
            data-tauri-drag-region="false"
          >
            {t("transcription.review.insert", "Insert")}{" "}
            <span className="opacity-60 ml-1 font-normal">
              {insertShortcut}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
