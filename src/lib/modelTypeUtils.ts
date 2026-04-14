import type { ModelType } from "./types";

type InferModelTypeInput = {
  modelId: string;
  customLabel?: string | null;
  name?: string | null;
  capabilities?: string | null;
};

const ASR_KEYWORDS = [
  "asr",
  "speech2text",
  "speech-to-text",
  "stt",
  "whisper",
  "sensevoice",
  "paraformer",
  "fire-red",
  "transcription",
  "speech",
  "voice",
];

const TEXT_KEYWORDS = [
  "chat",
  "instruct",
  "reasoner",
  "reasoning",
  "coder",
  "gpt",
  "claude",
  "gemini",
  "qwen",
  "llama",
  "deepseek",
  "文本",
  "润色",
];

function normalize(input?: string | null) {
  return input?.trim().toLowerCase() ?? "";
}

function includesKeyword(haystack: string, keywords: string[]) {
  return keywords.some((keyword) => haystack.includes(keyword));
}

export function inferModelType({
  modelId,
  customLabel,
  name,
  capabilities,
}: InferModelTypeInput): ModelType {
  const capabilityText = normalize(capabilities);
  if (
    capabilityText.includes("speech2text") ||
    capabilityText.includes("语音") ||
    capabilityText.includes("asr")
  ) {
    return "asr";
  }

  const combined = [modelId, customLabel, name].map(normalize).join(" ");
  if (includesKeyword(combined, ASR_KEYWORDS)) {
    return "asr";
  }

  if (includesKeyword(combined, TEXT_KEYWORDS)) {
    return "text";
  }

  return "text";
}

export function getModelTypeLabel(modelType: ModelType): string {
  switch (modelType) {
    case "asr":
      return "ASR";
    case "other":
      return "Other";
    case "text":
    default:
      return "Text";
  }
}
