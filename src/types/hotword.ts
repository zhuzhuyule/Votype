export type HotwordCategory = string;
export type HotwordScenario = "work" | "casual";

export type HotwordStatus = "active" | "suggested";
export type HotwordSource = "manual" | "auto_learned" | "ai_extracted";

export interface Hotword {
  id: number;
  originals: string[];
  target: string;
  category: HotwordCategory;
  scenarios: HotwordScenario[];
  user_override: boolean;
  use_count: number;
  last_used_at: number | null;
  false_positive_count: number;
  created_at: number;
  status: HotwordStatus;
  source: HotwordSource;
}

export interface HotwordCategoryMeta {
  id: string;
  label: string;
  color: string;
  icon: string;
  sort_order: number;
  is_builtin: boolean;
}

export const SOURCE_LABELS: Record<HotwordSource, string> = {
  manual: "手动",
  auto_learned: "自动学习",
  ai_extracted: "AI 提取",
};

export const SCENARIO_LABELS: Record<HotwordScenario, string> = {
  work: "工作",
  casual: "日常",
};
