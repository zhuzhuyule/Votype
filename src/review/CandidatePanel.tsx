// Single candidate panel component for multi-model review mode

import { Tooltip } from "@radix-ui/themes";
import { IconTextPlus } from "@tabler/icons-react";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import React, { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DiffMark } from "./diff-mark";
import {
  buildDiffViews,
  buildPlainViews,
  computeChangePercent,
} from "./diff-utils";

export interface MultiModelCandidate {
  id: string;
  label: string;
  provider_label: string;
  text: string;
  confidence?: number;
  processing_time_ms: number;
  error?: string;
  ready?: boolean;
  /** Output speed in estimated tokens per second */
  output_speed?: number;
}

interface CandidatePanelProps {
  candidate: MultiModelCandidate;
  sourceText: string;
  showDiff: boolean;
  index: number;
  shortcutIndex?: number;
  showShortcutHint?: boolean;
  isSelected: boolean;
  isEditing: boolean;
  maxTime: number;
  timeRank?: number;
  /** Counts for 1st/2nd/3rd place finishes for this candidate */
  rankCounts?: Partial<Record<1 | 2 | 3, number>>;
  editedText?: string;
  onSelect: () => void;
  onEditEnd: () => void;
  onTextChange: (text: string) => void;
  onInsert: (text: string, candidateId: string) => void;
}

function formatProcessingTime(ms: number): string {
  if (ms <= 0) return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatSpeed(tokensPerSec: number): string {
  if (tokensPerSec >= 100) return `${Math.round(tokensPerSec)} t/s`;
  if (tokensPerSec >= 10) return `${tokensPerSec.toFixed(0)} t/s`;
  return `${tokensPerSec.toFixed(1)} t/s`;
}

export const CandidatePanel: React.FC<CandidatePanelProps> = ({
  candidate,
  sourceText,
  showDiff,
  index,
  shortcutIndex,
  showShortcutHint = false,
  isSelected,
  isEditing,
  maxTime,
  timeRank,
  rankCounts,
  editedText,
  onSelect,
  onEditEnd,
  onTextChange,
  onInsert,
}) => {
  const { t } = useTranslation();
  const displayText = editedText ?? candidate.text;

  // Track whether content was set programmatically to avoid echo in onUpdate
  const suppressUpdateRef = useRef(false);

  // Compute initial HTML content with diff marks
  const editorHtml = useMemo(() => {
    if (!candidate.ready || candidate.error || !displayText) return "";
    if (showDiff) {
      return buildDiffViews(sourceText, displayText).targetHtml;
    }
    return buildPlainViews(sourceText, displayText).targetHtml;
  }, [showDiff, sourceText, displayText, candidate.ready, candidate.error]);

  // Compute change percent for header stats
  const changePercent = useMemo(() => {
    if (!candidate.ready || candidate.error || !displayText) return null;
    return computeChangePercent(sourceText, displayText);
  }, [sourceText, displayText, candidate.ready, candidate.error]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          code: false,
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          horizontalRule: false,
        }),
        DiffMark,
      ],
      content: editorHtml,
      editorProps: {
        attributes: {
          class: "candidate-tiptap-editor",
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (suppressUpdateRef.current) return;
        const text = ed.getText({ blockSeparator: "\n" });
        onTextChange(text);
      },
      onFocus: () => {
        onSelect();
      },
      onBlur: () => {
        onEditEnd();
      },
    },
    [candidate.id],
  );

  // Sync content when candidate text changes externally (e.g. new result arrives)
  const prevCandidateTextRef = useRef(candidate.text);
  useEffect(() => {
    if (!editor || !candidate.ready || candidate.error) return;
    // Only reset content when the candidate's original text changes (new result)
    // Don't reset on editedText changes (user typing)
    if (prevCandidateTextRef.current !== candidate.text) {
      prevCandidateTextRef.current = candidate.text;
      const html = showDiff
        ? buildDiffViews(sourceText, candidate.text).targetHtml
        : buildPlainViews(sourceText, candidate.text).targetHtml;
      suppressUpdateRef.current = true;
      editor.commands.setContent(html, { emitUpdate: false });
      suppressUpdateRef.current = false;
    }
  }, [
    editor,
    candidate.text,
    candidate.ready,
    candidate.error,
    sourceText,
    showDiff,
  ]);

  // Focus/blur editor based on editing state
  useEffect(() => {
    if (!editor) return;
    if (isEditing) {
      editor.commands.focus("end");
    }
  }, [editor, isEditing]);

  return (
    <div
      key={candidate.id}
      className={`candidate-panel candidate-tint-${index % 4} ${
        isSelected ? "selected" : ""
      } ${isEditing ? "editing" : ""} ${candidate.error ? "error" : ""} ${!candidate.ready ? "loading" : ""}`}
      onClick={() => {
        if (candidate.ready && !candidate.error) {
          onSelect();
        }
      }}
    >
      <div className="candidate-panel-header">
        {/* Time fill inside header as progress indicator */}
        <div
          className={`candidate-header-fill${!candidate.ready ? " loading" : ""}`}
          style={
            candidate.ready && candidate.processing_time_ms > 0
              ? {
                  width: `${(candidate.processing_time_ms / maxTime) * 100}%`,
                }
              : undefined
          }
        />
        {/* Left: rank/shortcut + model + provider badge + change% */}
        <span className="candidate-label">
          {showShortcutHint && shortcutIndex != null && shortcutIndex <= 5 ? (
            <span className="candidate-rank shortcut-active">
              {shortcutIndex}
            </span>
          ) : candidate.ready && !candidate.error && timeRank ? (
            <span className={`candidate-rank rank-${timeRank}`}>
              {timeRank}
            </span>
          ) : (
            <span className="candidate-rank skeleton" />
          )}
          {candidate.label}
          <span className="candidate-provider-badge">
            {candidate.provider_label}
          </span>
          {candidate.ready && !candidate.error && changePercent != null ? (
            <span
              className={`candidate-change-percent ${changePercent < 20 ? "low" : changePercent < 40 ? "mid" : "high"}`}
            >
              ±{changePercent}%
            </span>
          ) : !candidate.ready ? (
            <span className="candidate-change-percent skeleton-text" />
          ) : null}
        </span>
        {/* Right: rank history counts | time */}
        <div className="candidate-meta">
          {candidate.ready ? (
            <>
              {candidate.error ? (
                <span className="error-badge">
                  {t("common.error", "Error")}
                </span>
              ) : (
                <span className="candidate-header-stats">
                  {rankCounts && (
                    <span className="candidate-rank-history">
                      {([1, 2, 3] as const).map((r, i) => (
                        <React.Fragment key={r}>
                          {i > 0 && <span className="rank-sep">/</span>}
                          <span
                            className={`rank-count${timeRank === r ? " rank-active" : ""}`}
                          >
                            {rankCounts[r] ?? 0}
                          </span>
                        </React.Fragment>
                      ))}
                    </span>
                  )}
                  {candidate.processing_time_ms > 0 && rankCounts && (
                    <span className="stat-separator">|</span>
                  )}
                  {candidate.processing_time_ms > 0 && (
                    <span>
                      {formatProcessingTime(candidate.processing_time_ms)}
                    </span>
                  )}
                  {candidate.output_speed != null &&
                    candidate.output_speed > 0 && (
                      <>
                        <span className="stat-separator">|</span>
                        <span className="candidate-speed">
                          {formatSpeed(candidate.output_speed)}
                        </span>
                      </>
                    )}
                </span>
              )}
            </>
          ) : (
            <span className="candidate-header-stats">
              <span className="skeleton-text stat-placeholder" />
              <span className="stat-separator">|</span>
              <span className="skeleton-text stat-placeholder-sm" />
            </span>
          )}
        </div>
      </div>
      <div className="candidate-panel-content">
        {candidate.ready ? (
          candidate.error ? (
            <span className="candidate-error-text">{candidate.error}</span>
          ) : (
            <>
              <div className="candidate-editable-container">
                <EditorContent editor={editor} />
              </div>
              <Tooltip content={t("transcription.review.insert", "Insert")}>
                <button
                  type="button"
                  className="candidate-insert-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInsert(displayText, candidate.id);
                  }}
                >
                  <IconTextPlus size={16} />
                </button>
              </Tooltip>
            </>
          )
        ) : (
          <div className="candidate-loading-shimmer" />
        )}
      </div>
    </div>
  );
};
