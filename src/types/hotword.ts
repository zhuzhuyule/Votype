export type HotwordCategory = string;
export type HotwordScenario = "work" | "casual";

export type HotwordStatus = "active" | "suggested";
export type HotwordSource = "manual" | "auto_learned" | "ai_extracted";

export interface Hotword {
  id: number;
  originals: string[];
  force_replace_originals: string[];
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

// 这里是 i18n key 而不是展示文案：本文件是纯 TS 模块，拿不到 useTranslation，
// 由消费方组件负责 t() 解析。
export const SOURCE_LABEL_KEYS: Record<HotwordSource, string> = {
  manual: "hotword.source.manual",
  auto_learned: "hotword.source.autoLearned",
  ai_extracted: "hotword.source.aiExtracted",
};

export const SCENARIO_LABEL_KEYS: Record<HotwordScenario, string> = {
  work: "hotword.scenario.work",
  casual: "hotword.scenario.casual",
};
