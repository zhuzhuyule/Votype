export interface VocabularyBufferItem {
  id: number;
  word: string;
  normalized_word: string;
  category: string;
  confidence: number;
  frequency_count: number;
  frequency_type: string;
  possible_typo: boolean;
  similar_suggestions: string[] | null;
  context_sample: string | null;
  source_summary_id: number | null;
  extraction_date: string;
  cumulative_count: number;
  days_appeared: number;
  user_decision: string | null;
  promoted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface BufferStats {
  total: number;
  high_confidence: number;
  typos: number;
  promoted: number;
}

export type UserDecision = "approve" | "reject" | "ignore";
