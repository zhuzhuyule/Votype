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
  effective_text: string;
}

/** Structured AI analysis result */
export interface AiAnalysisSection {
  title: string;
  content?: string;
  items?: string[];
}

export interface AiAnalysisResult {
  summary: AiAnalysisSection;
  activities: AiAnalysisSection;
  highlights: AiAnalysisSection;
}

/** Legacy format for backwards compatibility */
interface LegacyAiAnalysisResult {
  style?: AiAnalysisSection;
  patterns?: AiAnalysisSection;
  suggestions?: AiAnalysisSection;
}

/** Parse AI summary JSON, returns null if parsing fails */
export function parseAiAnalysis(
  aiSummary: string | null,
): AiAnalysisResult | null {
  if (!aiSummary) return null;
  try {
    // Extract JSON from markdown code block if present
    const jsonMatch = aiSummary.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : aiSummary;
    const parsed = JSON.parse(jsonStr) as AiAnalysisResult &
      LegacyAiAnalysisResult;

    // Handle new format
    if (parsed.summary && parsed.activities && parsed.highlights) {
      return parsed;
    }

    // Convert legacy format to new format
    if (parsed.style || parsed.patterns || parsed.suggestions) {
      return {
        summary: parsed.style || { title: "沟通风格", content: "" },
        activities: parsed.patterns || { title: "表达特征", items: [] },
        highlights: parsed.suggestions || { title: "改进建议", items: [] },
      };
    }

    return null;
  } catch {
    return null;
  }
}

export type PeriodType = "day" | "week" | "month" | "custom";

export type FeedbackStyle = "neutral" | "encouraging" | "direct";

export interface PeriodSelection {
  type: PeriodType;
  startTs: number;
  endTs: number;
  label: string;
}
