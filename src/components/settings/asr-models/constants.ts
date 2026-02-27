// Constants for ASR Models Settings

import type { LanguageKey, TypeKey } from "./types";

// Recommended model IDs for highlighting
export const RECOMMENDED_MODEL_IDS = new Set([
  "parakeet-0.4a",
  "tiny-q5",
  "base-q5",
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
export const TYPE_KEYS: TypeKey[] = ["whisper", "parakeet", "other"];

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
