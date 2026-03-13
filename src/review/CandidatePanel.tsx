// Single candidate panel component for multi-model review mode

import { Tooltip } from "@radix-ui/themes";
import { IconTextPlus } from "@tabler/icons-react";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export interface MultiModelCandidate {
  id: string;
  label: string;
  text: string;
  confidence?: number;
  processing_time_ms: number;
  error?: string;
  ready?: boolean;
}

interface CandidatePanelProps {
  candidate: MultiModelCandidate;
  index: number;
  shortcutIndex?: number;
  showShortcutHint?: boolean;
  isSelected: boolean;
  isEditing: boolean;
  maxTime: number;
  timeRank?: number;
  rankCount?: number;
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

export const CandidatePanel: React.FC<CandidatePanelProps> = ({
  candidate,
  index,
  shortcutIndex,
  showShortcutHint = false,
  isSelected,
  isEditing,
  maxTime,
  timeRank,
  rankCount,
  editedText,
  onSelect,
  onEditEnd,
  onTextChange,
  onInsert,
}) => {
  const { t } = useTranslation();
  const displayText = editedText ?? candidate.text;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track whether blur was caused by our keydown handler (Esc/Tab)
  const blurFromKeydownRef = useRef(false);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    } else if (!isEditing && textareaRef.current) {
      textareaRef.current.blur();
    }
  }, [isEditing]);

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
        <span className="candidate-label">
          {candidate.label}
          {showShortcutHint && shortcutIndex != null && shortcutIndex <= 5 && (
            <span className="candidate-shortcut-badge">{shortcutIndex}</span>
          )}
        </span>
        <div className="candidate-meta">
          {candidate.ready ? (
            <>
              {candidate.error ? (
                <span className="error-badge">
                  {t("common.error", "Error")}
                </span>
              ) : (
                <span className="candidate-header-stats">
                  {timeRank && (
                    <span className={`candidate-rank rank-${timeRank}`}>
                      {timeRank}
                    </span>
                  )}
                  {timeRank != null && timeRank <= 3 && rankCount != null && (
                    <span className="candidate-rank-count">
                      {t("transcription.review.rankCount", {
                        defaultValue: "第{{rank}}名 {{count}}次",
                        rank: timeRank,
                        count: rankCount,
                      })}
                    </span>
                  )}
                  {candidate.processing_time_ms > 0 && (
                    <span>
                      {formatProcessingTime(candidate.processing_time_ms)}
                    </span>
                  )}
                  {candidate.confidence != null &&
                    candidate.processing_time_ms > 0 && (
                      <span className="stat-separator">|</span>
                    )}
                  {candidate.confidence != null && (
                    <span>{candidate.confidence}%</span>
                  )}
                </span>
              )}
            </>
          ) : (
            <span className="candidate-loading-badge">
              {t("transcription.review.processing", "Processing...")}
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
              <textarea
                className="candidate-edit-textarea"
                value={displayText}
                onChange={(e) => {
                  const el = e.target;
                  onTextChange(el.value);
                  el.style.height = "auto";
                  el.style.height = el.scrollHeight + "px";
                }}
                ref={(el) => {
                  (
                    textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>
                  ).current = el;
                  if (el) {
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onFocus={onSelect}
                onBlur={() => {
                  // If blur was triggered by Esc/Tab keydown, skip —
                  // the keydown handler already set editingCandidateId = null
                  if (blurFromKeydownRef.current) {
                    blurFromKeydownRef.current = false;
                    return;
                  }
                  // External blur (e.g., mouse click outside): exit edit mode
                  onEditEnd();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || e.key === "Tab") {
                    blurFromKeydownRef.current = true;
                  }
                }}
              />
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
