// Single model diff view with source + output panels

import { Editor, EditorContent } from "@tiptap/react";
import { IconTextPlus } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

interface DiffViewPanelProps {
  sourceHtml: string;
  editor: Editor | null;
  isRerunning: boolean;
  currentModelName?: string;
  onInsertOriginal?: () => void;
}

export const DiffViewPanel: React.FC<DiffViewPanelProps> = ({
  sourceHtml,
  editor,
  isRerunning,
  currentModelName,
  onInsertOriginal,
}) => {
  const { t } = useTranslation();
  const [isSourceHovered, setIsSourceHovered] = useState(false);

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
      <div className="review-panel review-panel-output">
        <div className="review-panel-header">
          <span className="review-panel-label">
            {t("transcription.review.final", "Final output")}
          </span>
          {currentModelName && (
            <span className="review-model-tag">{currentModelName}</span>
          )}
        </div>
        <div className="review-panel-body review-output-content">
          {isRerunning ? (
            <div className="candidate-loading-shimmer" />
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>
    </div>
  );
};
