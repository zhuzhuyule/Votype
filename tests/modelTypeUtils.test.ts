import { describe, expect, test } from "bun:test";

import { getModelTypeLabel, inferModelType } from "../src/lib/modelTypeUtils";

describe("modelTypeUtils", () => {
  test("inferModelType recognizes explicit ASR keywords from model id", () => {
    expect(
      inferModelType({
        modelId: "gpt-4o-mini-asr",
      }),
    ).toBe("asr");
  });

  test("inferModelType recognizes speech-to-text capabilities", () => {
    expect(
      inferModelType({
        modelId: "some-model",
        capabilities: "speech2text",
      }),
    ).toBe("asr");
  });

  test("inferModelType falls back to text for common text models", () => {
    expect(
      inferModelType({
        modelId: "gpt-4.1-mini",
        customLabel: "主力润色模型",
      }),
    ).toBe("text");
  });

  test("getModelTypeLabel returns text label instead of standard", () => {
    expect(getModelTypeLabel("text")).toBe("Text");
  });
});
