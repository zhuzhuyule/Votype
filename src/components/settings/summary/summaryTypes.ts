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

export interface AiAnalysisEntry {
  timestamp: number;
  model: string;
  summary: string;
  reflection: string;
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
  ai_history?: AiAnalysisEntry[]; // History of AI analysis
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

/** Focus assessment for daily reports */
export interface FocusAssessment {
  title: string;
  score: number; // 0-10
  comment: string;
}

export interface AiAnalysisResult {
  // Core fields (all reports)
  summary: AiAnalysisSection;
  activities: AiAnalysisSection;
  highlights: AiAnalysisSection;

  // Extended fields
  work_focus?: AiAnalysisSection;
  communication_patterns?: AiAnalysisSection;
  insights?: AiAnalysisSection;

  // Day-specific fields
  todos_extracted?: AiAnalysisSection;
  focus_assessment?: FocusAssessment;

  // Week-specific fields
  patterns?: AiAnalysisSection;
  next_week?: AiAnalysisSection;

  // Month-specific fields
  trends?: AiAnalysisSection;
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

    // Handle new format (requires at least summary)
    if (parsed.summary) {
      return {
        summary: parsed.summary,
        activities: parsed.activities || { title: "具体活动", items: [] },
        highlights: parsed.highlights || { title: "亮点", items: [] },
        // Extended fields
        work_focus: parsed.work_focus,
        communication_patterns: parsed.communication_patterns,
        insights: parsed.insights,
        // Day-specific
        todos_extracted: parsed.todos_extracted,
        focus_assessment: parsed.focus_assessment,
        // Week-specific
        patterns: parsed.patterns,
        next_week: parsed.next_week,
        // Month-specific
        trends: parsed.trends,
      };
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

export type PeriodType = "day" | "week" | "month" | "year" | "custom";

export type FeedbackStyle = "neutral" | "encouraging" | "direct";

export interface PeriodSelection {
  type: PeriodType;
  startTs: number;
  endTs: number;
  label: string;
}
