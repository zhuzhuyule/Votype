export type HotwordCategory = "person" | "term" | "brand" | "abbreviation";
export type HotwordScenario = "work" | "casual";

export interface Hotword {
  id: number;
  originals: string[];
  target: string;
  category: HotwordCategory;
  scenarios: HotwordScenario[];
  confidence: number;
  user_override: boolean;
  use_count: number;
  last_used_at: number | null;
  false_positive_count: number;
  created_at: number;
}

export const CATEGORY_LABELS: Record<HotwordCategory, string> = {
  person: "人名",
  term: "术语",
  brand: "品牌",
  abbreviation: "缩写",
};

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
