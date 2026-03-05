export type HotwordCategory = "person" | "term" | "brand" | "abbreviation";
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

export const SOURCE_LABELS: Record<HotwordSource, string> = {
  manual: "手动",
  auto_learned: "自动学习",
  ai_extracted: "AI 提取",
};

export const CATEGORY_LABELS: Record<HotwordCategory, string> = {
  person: "人名",
  term: "术语",
  brand: "品牌",
  abbreviation: "缩写",
};

/** @deprecated Use CATEGORY_ICON_NAMES with tabler icons instead */
export const CATEGORY_ICONS: Record<HotwordCategory, string> = {
  person: "👤",
  term: "🔧",
  brand: "🏢",
  abbreviation: "🔤",
};

export const SCENARIO_LABELS: Record<HotwordScenario, string> = {
  work: "工作",
  casual: "日常",
};
