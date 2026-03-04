// Single model diff view with source + output panels

import { Editor, EditorContent } from "@tiptap/react";
import React from "react";
import { useTranslation } from "react-i18next";

interface DiffViewPanelProps {
  sourceHtml: string;
  editor: Editor | null;
  isRerunning: boolean;
  currentModelName?: string;
}

export const DiffViewPanel: React.FC<DiffViewPanelProps> = ({
  sourceHtml,
  editor,
  isRerunning,
  currentModelName,
}) => {
  const { t } = useTranslation();

  return (
    <div className="review-content-area review-panels-layout">
      {/* Source text — simple inline frame */}
      <div
        className="review-source-inline"
        dangerouslySetInnerHTML={{
          __html: sourceHtml || "—",
        }}
      />
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
