// Multi-model candidate panel container

import { ScrollArea } from "@radix-ui/themes";
import { IconTextPlus } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CandidatePanel,
  ModelSpeedStats,
  MultiModelCandidate,
} from "./CandidatePanel";
import { buildDiffViews } from "./diff-utils";

interface MultiCandidateViewProps {
  sourceText: string;
  showDiff: boolean;
  candidates: MultiModelCandidate[];
  showShortcutHints?: boolean;
  rankStats?: Record<string, Partial<Record<1 | 2 | 3, number>>>;
  selectedCandidateId: string | null;
  selectedCandidateText: string | null;
  editingCandidateId: string | null;
  editedTexts: Record<string, string>;
  onCandidateSelect: (id: string) => void;
  onEditEnd: () => void;
  onTextChange: (candidateId: string, text: string) => void;
  onInsert: (text: string, candidateId: string) => void;
  onInsertOriginal?: () => void;
  /** Which modifier the user is holding. Combined with `insertModifier`
   *  it tells the selected candidate panel to render an armed NeonBorder. */
  pressedModifier?: "meta" | "ctrl" | null;
  /** Which modifier binds to the main Insert action (⌃⏎ when translation
   *  is in play, ⌘⏎ otherwise). */
  insertModifier?: "meta" | "ctrl";
}

export const MultiCandidateView: React.FC<MultiCandidateViewProps> = ({
  sourceText,
  showDiff,
  candidates,
  showShortcutHints = false,
  rankStats,
  selectedCandidateId,
  selectedCandidateText,
  editingCandidateId,
  editedTexts,
  onCandidateSelect,
  onEditEnd,
  onTextChange,
  onInsert,
  onInsertOriginal,
  pressedModifier = null,
  insertModifier = "meta",
}) => {
  const { t } = useTranslation();
  const [isSourceHovered, setIsSourceHovered] = useState(false);
  const [speedStats, setSpeedStats] = useState<ModelSpeedStats[]>([]);

  useEffect(() => {
    invoke<ModelSpeedStats[]>("get_model_speed_stats")
      .then(setSpeedStats)
      .catch((err) => console.warn("Failed to fetch speed stats:", err));
  }, []);

  const maxTime = Math.max(...candidates.map((c) => c.processing_time_ms), 1);

  // Compute source diff HTML when a candidate is selected and diff is enabled
  const sourceDiffHtml = useMemo(() => {
    if (!showDiff || !selectedCandidateText) return null;
    return buildDiffViews(sourceText, selectedCandidateText).sourceHtml;
  }, [showDiff, sourceText, selectedCandidateText]);

  // Compute time ranking: fastest = 1
  const readyWithTime = candidates
    .filter((c) => c.ready && !c.error && c.processing_time_ms > 0)
    .sort((a, b) => a.processing_time_ms - b.processing_time_ms);
  const timeRankMap = new Map<string, number>();
  readyWithTime.forEach((c, i) => timeRankMap.set(c.id, i + 1));

  return (
    <div className="review-multi-content">
      <ScrollArea scrollbars="vertical" className="multi-candidates-panels">
        {/* Source transcription as a simple inline frame with hover insert button */}
        <div
          className="review-source-inline"
          onMouseEnter={() => setIsSourceHovered(true)}
          onMouseLeave={() => setIsSourceHovered(false)}
        >
          {sourceDiffHtml ? (
            <span dangerouslySetInnerHTML={{ __html: sourceDiffHtml }} />
          ) : (
            sourceText || "—"
          )}
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

        {candidates.map((candidate, index) => (
          <CandidatePanel
            key={candidate.id}
            candidate={candidate}
            sourceText={sourceText}
            showDiff={showDiff}
            index={index}
            shortcutIndex={index + 1}
            showShortcutHint={showShortcutHints}
            isSelected={selectedCandidateId === candidate.id}
            isArmed={
              selectedCandidateId === candidate.id &&
              pressedModifier === insertModifier
            }
            isEditing={editingCandidateId === candidate.id}
            maxTime={maxTime}
            timeRank={timeRankMap.get(candidate.id)}
            rankCounts={rankStats?.[candidate.id]}
            editedText={editedTexts[candidate.id]}
            onSelect={() => onCandidateSelect(candidate.id)}
            onEditEnd={onEditEnd}
            onTextChange={(text) => onTextChange(candidate.id, text)}
            onInsert={onInsert}
            speedStats={speedStats}
          />
        ))}
      </ScrollArea>
    </div>
  );
};
