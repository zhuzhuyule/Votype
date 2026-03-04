// Multi-model candidate panel container

import { ScrollArea } from "@radix-ui/themes";
import React from "react";
import { CandidatePanel, MultiModelCandidate } from "./CandidatePanel";

interface MultiCandidateViewProps {
  sourceText: string;
  candidates: MultiModelCandidate[];
  selectedCandidateId: string | null;
  editedTexts: Record<string, string>;
  onCandidateSelect: (id: string) => void;
  onTextChange: (candidateId: string, text: string) => void;
  onInsert: (text: string, candidateId: string) => void;
}

export const MultiCandidateView: React.FC<MultiCandidateViewProps> = ({
  sourceText,
  candidates,
  selectedCandidateId,
  editedTexts,
  onCandidateSelect,
  onTextChange,
  onInsert,
}) => {
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
        {/* Source transcription as a simple inline frame */}
        <div className="review-source-inline">{sourceText || "—"}</div>

        {candidates.map((candidate, index) => (
          <CandidatePanel
            key={candidate.id}
            candidate={candidate}
            index={index}
            isSelected={selectedCandidateId === candidate.id}
            maxTime={maxTime}
            timeRank={timeRankMap.get(candidate.id)}
            editedText={editedTexts[candidate.id]}
            onSelect={() => onCandidateSelect(candidate.id)}
            onTextChange={(text) => onTextChange(candidate.id, text)}
            onInsert={onInsert}
          />
        ))}
      </ScrollArea>
    </div>
  );
};
