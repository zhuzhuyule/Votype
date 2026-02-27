// Type definitions for ASR Models Settings

export type StatusFilter = "all" | "downloaded" | "favorites" | "recommended";

export type ModeKey = "offline";

export type TypeKey = "whisper" | "parakeet" | "other";

export type LanguageKey =
  | "zh"
  | "yue"
  | "en"
  | "ja"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "ru"
  | "multilingual"
  | "other";

export interface AsrModelsSettingsProps {
  className?: string;
  hideHeader?: boolean;
}

// Size bucket type for model size categorization
export type SizeBucket = "small" | "medium" | "large" | "unknown";
