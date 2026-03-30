// Constants for ASR Models Settings

import type { LanguageKey, TypeKey } from "./types";

// Recommended model IDs for highlighting
export const RECOMMENDED_MODEL_IDS = new Set([
  "sherpa-sensevoice-zh-en-ja-ko-yue-int8-2025-09-09",
  "parakeet-tdt-0.6b-v3",
  "sherpa-zipformer-zh-en-small",
  "sherpa-paraformer-trilingual-zh-cantonese-en",
]);

// All available language keys in display order
export const ALL_LANGUAGE_KEYS: LanguageKey[] = [
  "zh",
  "en",
  "yue",
  "ja",
  "ko",
  "de",
  "es",
  "fr",
  "ru",
  "multilingual",
  "other",
];

// All available type keys
export const TYPE_KEYS: TypeKey[] = [
  "whisper",
  "parakeet",
  "moonshine",
  "sensevoice",
  "zipformer",
  "paraformer",
  "other",
];

// Known language keys for parsing
export const KNOWN_LANGUAGE_KEYS: LanguageKey[] = [
  "zh",
  "yue",
  "en",
  "ja",
  "ko",
  "de",
  "es",
  "fr",
  "ru",
  "multilingual",
  "other",
];
