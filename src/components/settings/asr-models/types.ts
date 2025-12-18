// Type definitions for ASR Models Settings


export type StatusFilter = "all" | "downloaded" | "favorites" | "recommended";

export type ModeKey = "streaming" | "offline" | "punctuation";

export type TypeKey =
    | "whisper"
    | "parakeet"
    | "sherpa_transducer"
    | "sherpa_paraformer"
    | "sherpa_sense_voice"
    | "sherpa_fire_red_asr"
    | "punctuation"
    | "other";

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
