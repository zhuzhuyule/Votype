// Multi-model candidate panel container

import { ScrollArea } from "@radix-ui/themes";
import { IconTextPlus } from "@tabler/icons-react";
import React, { useState } from "react";
import { CandidatePanel, MultiModelCandidate } from "./CandidatePanel";

interface MultiCandidateViewProps {
  sourceText: string;
  candidates: MultiModelCandidate[];
  showShortcutHints?: boolean;
  rankStats?: Record<string, Partial<Record<1 | 2 | 3, number>>>;
  selectedCandidateId: string | null;
  editingCandidateId: string | null;
  editedTexts: Record<string, string>;
  onCandidateSelect: (id: string) => void;
  onEditEnd: () => void;
  onTextChange: (candidateId: string, text: string) => void;
  onInsert: (text: string, candidateId: string) => void;
  onInsertOriginal?: () => void;
}

export const MultiCandidateView: React.FC<MultiCandidateViewProps> = ({
  sourceText,
  candidates,
  showShortcutHints = false,
  rankStats,
  selectedCandidateId,
  editingCandidateId,
  editedTexts,
  onCandidateSelect,
  onEditEnd,
  onTextChange,
  onInsert,
  onInsertOriginal,
}) => {
  const [isSourceHovered, setIsSourceHovered] = useState(false);
  const maxTime = Math.max(...candidates.map((c) => c.processing_time_ms), 1);

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
          {sourceText || "—"}
          {isSourceHovered && onInsertOriginal && (
            <button
              className="review-source-insert-btn"
              onClick={onInsertOriginal}
              title="插入原文 (Tab)"
            >
              <IconTextPlus size={16} />
            </button>
          )}
        </div>

        {candidates.map((candidate, index) => (
          <CandidatePanel
            key={candidate.id}
            candidate={candidate}
            index={index}
            shortcutIndex={index + 1}
            showShortcutHint={showShortcutHints}
            isSelected={selectedCandidateId === candidate.id}
            isEditing={editingCandidateId === candidate.id}
            maxTime={maxTime}
            timeRank={timeRankMap.get(candidate.id)}
            rankCount={
              timeRankMap.get(candidate.id) &&
              timeRankMap.get(candidate.id)! <= 3
                ? rankStats?.[candidate.id]?.[
                    timeRankMap.get(candidate.id)! as 1 | 2 | 3
                  ]
                : undefined
            }
            editedText={editedTexts[candidate.id]}
            onSelect={() => onCandidateSelect(candidate.id)}
            onEditEnd={onEditEnd}
            onTextChange={(text) => onTextChange(candidate.id, text)}
            onInsert={onInsert}
          />
        ))}
      </ScrollArea>
    </div>
  );
};
