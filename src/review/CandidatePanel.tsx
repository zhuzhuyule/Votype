// Single candidate panel component for multi-model review mode

import { Tooltip } from "@radix-ui/themes";
import { IconTextPlus } from "@tabler/icons-react";
import React from "react";
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
  isSelected: boolean;
  maxTime: number;
  timeRank?: number;
  editedText?: string;
  onSelect: () => void;
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
  isSelected,
  maxTime,
  timeRank,
  editedText,
  onSelect,
  onTextChange,
  onInsert,
}) => {
  const { t } = useTranslation();
  const displayText = editedText ?? candidate.text;

  return (
    <div
      key={candidate.id}
      className={`candidate-panel candidate-tint-${index % 4} ${
        isSelected ? "selected" : ""
      } ${candidate.error ? "error" : ""} ${!candidate.ready ? "loading" : ""}`}
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
        <span className="candidate-label">{candidate.label}</span>
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
                  if (el) {
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onFocus={onSelect}
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
