export interface AppStats {
  count: number;
  chars: number;
}

export interface SummaryStats {
  entry_count: number;
  total_duration_ms: number;
  total_chars: number;
  llm_calls: number;
  by_app: Record<string, AppStats>;
  by_hour: number[];
  top_skills: string[];
}

export interface Summary {
  id: number;
  period_type: string;
  period_start: number;
  period_end: number;
  stats: SummaryStats;
  ai_summary: string | null;
  ai_reflection: string | null;
  ai_generated_at: number | null;
  ai_model_used: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserProfile {
  vocabulary_stats: string | null;
  expression_stats: string | null;
  app_usage_stats: string | null;
  time_pattern_stats: string | null;
  communication_style: string | null;
  tone_preference: string | null;
  style_prompt: string | null;
  feedback_style: string;
  last_analyzed_at: number | null;
  updated_at: number;
}

export interface AnalysisEntry {
  id: number;
  timestamp: number;
  transcription_text: string;
  post_processed_text: string | null;
  app_name: string | null;
  char_count: number | null;
}

export type PeriodType = "day" | "week" | "month" | "custom";

export type FeedbackStyle = "neutral" | "encouraging" | "direct";

export interface PeriodSelection {
  type: PeriodType;
  startTs: number;
  endTs: number;
  label: string;
}
