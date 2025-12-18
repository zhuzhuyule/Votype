// Constants for ASR Models Settings

import type { LanguageKey, TypeKey } from "./types";

// Recommended model IDs for highlighting
export const RECOMMENDED_MODEL_IDS = new Set([
    "sherpa-paraformer-zh-en-streaming",
    "sherpa-paraformer-trilingual-zh-cantonese-en",
    "sherpa-zipformer-small-ctc-zh-int8-2025-04-01",
    "punct-zh-en-ct-transformer-2024-04-12-int8",
    "sherpa-paraformer-zh-small-2024-03-09",
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
    "sherpa_transducer",
    "sherpa_paraformer",
    "sherpa_sense_voice",
    "sherpa_fire_red_asr",
    "punctuation",
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
