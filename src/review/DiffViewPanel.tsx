// Single model diff view with source + output panels

import { Editor, EditorContent } from "@tiptap/react";
import { IconTextPlus } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChangeStats } from "./diff-utils";

interface DiffViewPanelProps {
  sourceHtml: string;
  editor: Editor | null;
  isRerunning: boolean;
  currentModelName?: string;
  changeStats?: ChangeStats | null;
  onInsertOriginal?: () => void;
  onInsertPolished?: () => void;
  showInsertPolished?: boolean;
}

export const DiffViewPanel: React.FC<DiffViewPanelProps> = ({
  sourceHtml,
  editor,
  isRerunning,
  currentModelName,
  changeStats,
  onInsertOriginal,
  onInsertPolished,
  showInsertPolished = true,
}) => {
  const { t } = useTranslation();
  const [isSourceHovered, setIsSourceHovered] = useState(false);

  const focusEditor = () => {
    editor?.commands.focus();
  };

  return (
    <div className="review-content-area review-panels-layout">
      {/* Source text — simple inline frame with hover insert button */}
      <div
        className="review-source-inline"
        onMouseEnter={() => setIsSourceHovered(true)}
        onMouseLeave={() => setIsSourceHovered(false)}
      >
        <div dangerouslySetInnerHTML={{ __html: sourceHtml || "—" }} />
        {isSourceHovered && onInsertOriginal && (
          <button
            className="review-source-insert-btn"
            onClick={onInsertOriginal}
            title={t("transcription.review.insertOriginal")}
          >
            <IconTextPlus size={16} />
          </button>
        )}
      </div>
      {/* Final output panel */}
      <div className="review-panel review-panel-output review-polish-surface">
        <div className="review-panel-header">
          <span className="review-panel-label">
            {t("transcription.review.final", "Final output")}
          </span>
          {currentModelName && (
            <span className="review-model-tag">{currentModelName}</span>
          )}
          {changeStats && changeStats.changePercent !== 0 && (
            <span
              className={`review-change-stats ${Math.abs(changeStats.changePercent) < 20 ? "low" : Math.abs(changeStats.changePercent) < 40 ? "mid" : "high"}`}
              title={`+${changeStats.addedChars} −${changeStats.removedChars}`}
            >
              {changeStats.changePercent > 0 ? "+" : ""}
              {changeStats.changePercent}%
            </span>
          )}
        </div>
        <div
          className="review-panel-body review-output-content"
          onMouseDown={(event) => {
            if (!(event.target instanceof HTMLElement)) {
              return;
            }

            if (event.target.closest("button")) {
              return;
            }

            if (event.target.closest(".ProseMirror")) {
              return;
            }
            event.preventDefault();
            focusEditor();
          }}
        >
          {isRerunning ? (
            <div className="candidate-loading-shimmer" />
          ) : (
            <EditorContent editor={editor} />
          )}
          {showInsertPolished && onInsertPolished && !isRerunning && (
            <button
              type="button"
              className="review-hover-insert-btn"
              onClick={onInsertPolished}
              title={t("transcription.review.insertPolished", "插入润色")}
              aria-label={t("transcription.review.insertPolished", "插入润色")}
            >
              <IconTextPlus size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
