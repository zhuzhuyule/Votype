// Bottom action bar for review window

import { IconCopy } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { NeonBorder } from "./NeonBorder";

interface ReviewFooterProps {
  reason?: string | null;
  outputMode?: "polish" | "chat";
  isSubmitting: boolean;
  hasText: boolean;
  insertShortcut: string;
  /** When translation is active ⌘⏎ is reserved for English, and the footer's
   *  Insert (bound to ⌃⏎) becomes the secondary action. */
  insertVariant?: "primary" | "secondary";
  /** User is holding the modifier bound to the footer's Insert — renders an
   *  animated NeonBorder around the button as a preview cue. */
  insertArmed?: boolean;
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
  insertVariant = "primary",
  insertArmed = false,
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
            className="review-btn-secondary review-footer-insert-btn"
            onClick={onCopy}
            disabled={isSubmitting || !hasText}
          >
            <IconCopy size={14} />
            {t("common.copy", "Copy")}
          </button>
        )}
        {hasInsert && (
          <button
            className={`${insertVariant === "primary" ? "review-btn-primary" : "review-btn-secondary"} review-footer-insert-btn`}
            onClick={onInsert}
            disabled={isSubmitting || !hasText}
            data-tauri-drag-region="false"
            data-mod-armed={insertArmed ? "true" : undefined}
          >
            {insertArmed && (
              <NeonBorder
                radius={8}
                gradientId="review-neon-gradient-footer-insert"
                strokeWidth={insertVariant === "primary" ? 2.6 : 1.6}
              />
            )}
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
