// Daily Vocabulary Types

export interface DailyVocabularyItem {
  id: number;
  date: string;
  word: string;
  context_type: string | null;
  frequency: number;
  source: string; // 'ai_extracted' | 'user_added'
  created_at: number;
  updated_at: number;
}

export interface HotwordItem {
  word: string;
  context_type: string | null;
  weight: number;
  total_occurrences: number;
  days_count: number;
  promotion_type: string; // 'manual' | 'auto'
  promoted_at: number | null;
  promoted_from_date: string | null;
}

export const CONTEXT_TYPES = [
  { value: "work", label: "工作相关" },
  { value: "life", label: "生活相关" },
  { value: "learning", label: "学习相关" },
  { value: "entertainment", label: "娱乐相关" },
  { value: "people", label: "人名" },
  { value: "location", label: "地点" },
  { value: "other", label: "其他" },
] as const;

export type ContextType = (typeof CONTEXT_TYPES)[number]["value"];
