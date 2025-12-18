// Utility functions for ASR Models Settings

import type { ModelInfo } from "../../../lib/types";
import { KNOWN_LANGUAGE_KEYS } from "./constants";
import type { LanguageKey, ModeKey, SizeBucket, TypeKey } from "./types";

/**
 * Parse language keys from a model's tags or ID
 */
export const parseLanguageKeys = (model: ModelInfo): LanguageKey[] => {
    // Check explicit tags first
    if (model.tags && model.tags.length > 0) {
        const explicit = model.tags.filter((t) =>
            KNOWN_LANGUAGE_KEYS.includes(t as LanguageKey)
        ) as LanguageKey[];
        if (explicit.length > 0) return explicit;
    }

    const id = (model.id ?? "").toLowerCase();
    const tokenSet = new Set<LanguageKey>();

    // Special case for specific model
    if (id === "sherpa-paraformer-zh-small-2024-03-09") {
        return ["multilingual", "zh", "en"];
    }

    // Parse language tokens from ID
    const re = /(^|[-_])(zh|yue|ct|cantonese|en|ja|ko|de|es|fr|ru)(?=([-_]|$))/g;
    for (const match of id.matchAll(re)) {
        const tok = match[2];
        if (tok === "ct" || tok === "cantonese") {
            tokenSet.add("yue");
        } else {
            tokenSet.add(tok as LanguageKey);
        }
    }

    const found = Array.from(tokenSet);
    if (found.length >= 2) return ["multilingual", ...found];
    if (found.length === 1) return found;
    return ["other"];
};

/**
 * Get the mode key for a model (streaming, offline, or punctuation)
 */
export const getModeKey = (m: ModelInfo): ModeKey => {
    if (m.engine_type === "SherpaOnnxPunctuation") return "punctuation";
    if (m.engine_type === "SherpaOnnx" && m.sherpa?.mode === "Streaming") {
        return "streaming";
    }
    return "offline";
};

/**
 * Get the type key for a model
 */
export const getTypeKey = (m: ModelInfo): TypeKey => {
    if (m.engine_type === "Whisper") return "whisper";
    if (m.engine_type === "Parakeet") return "parakeet";
    if (m.engine_type === "SherpaOnnxPunctuation") return "punctuation";

    if (m.engine_type === "SherpaOnnx") {
        switch (m.sherpa?.family) {
            case "Transducer":
            case "Zipformer2Ctc":
                return "sherpa_transducer";
            case "Paraformer":
                return "sherpa_paraformer";
            case "SenseVoice":
                return "sherpa_sense_voice";
            case "FireRedAsr":
                return "sherpa_fire_red_asr";
            default:
                return "other";
        }
    }

    return "other";
};

/**
 * Ordering function for mode keys
 */
export const orderMode = (k: ModeKey): number => {
    switch (k) {
        case "streaming":
            return 0;
        case "offline":
            return 1;
        case "punctuation":
            return 2;
    }
};

/**
 * Ordering function for type keys
 */
export const orderType = (k: TypeKey): number => {
    switch (k) {
        case "whisper":
            return 0;
        case "parakeet":
            return 1;
        case "sherpa_transducer":
            return 2;
        case "sherpa_paraformer":
            return 3;
        case "sherpa_sense_voice":
            return 4;
        case "sherpa_fire_red_asr":
            return 5;
        case "punctuation":
            return 6;
        case "other":
            return 99;
    }
};

/**
 * Ordering function for language keys
 */
export const orderLanguage = (k: LanguageKey): number => {
    switch (k) {
        case "multilingual":
            return 0;
        case "zh":
            return 1;
        case "en":
            return 2;
        case "yue":
            return 3;
        case "ja":
            return 4;
        case "ko":
            return 5;
        case "de":
            return 6;
        case "es":
            return 7;
        case "fr":
            return 8;
        case "ru":
            return 9;
        case "other":
            return 99;
    }
};

/**
 * Categorize model size into bucket
 */
export const sizeBucket = (sizeMb?: number): SizeBucket => {
    if (sizeMb == null || !Number.isFinite(sizeMb)) return "unknown";
    if (sizeMb < 100) return "small";
    if (sizeMb < 500) return "medium";
    return "large";
};

/**
 * Toggle a value in a Set (add if not present, remove if present)
 */
export const toggleSetValue = <T>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) {
        next.delete(value);
    } else {
        next.add(value);
    }
    return next;
};
