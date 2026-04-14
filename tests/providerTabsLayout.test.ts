import { describe, expect, test } from "bun:test";

import {
  buildProviderTabsLayout,
  type ProviderTabOption,
} from "../src/lib/providerTabsLayout";

const OPTIONS: ProviderTabOption[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "qwen", label: "Qwen" },
];

const WIDTHS = {
  anthropic: 90,
  gemini: 80,
  openai: 80,
  qwen: 70,
};

describe("providerTabsLayout", () => {
  test("keeps all items visible when width is sufficient", () => {
    expect(buildProviderTabsLayout(OPTIONS, "openai", WIDTHS, 500, 72)).toEqual(
      {
        visible: OPTIONS,
        overflow: [],
      },
    );
  });

  test("moves the selected overflow item into the last visible slot", () => {
    expect(buildProviderTabsLayout(OPTIONS, "qwen", WIDTHS, 250, 72)).toEqual({
      visible: [OPTIONS[0], OPTIONS[3]],
      overflow: [OPTIONS[1], OPTIONS[2]],
    });
  });

  test("keeps the original visible order when selected item is already visible", () => {
    expect(buildProviderTabsLayout(OPTIONS, "gemini", WIDTHS, 250, 72)).toEqual(
      {
        visible: [OPTIONS[0], OPTIONS[1]],
        overflow: [OPTIONS[2], OPTIONS[3]],
      },
    );
  });

  test("never returns a partially visible item and still keeps one visible tab", () => {
    expect(
      buildProviderTabsLayout(OPTIONS, "anthropic", WIDTHS, 60, 72),
    ).toEqual({
      visible: [OPTIONS[0]],
      overflow: [OPTIONS[1], OPTIONS[2], OPTIONS[3]],
    });
  });

  test("keeps the selected item visible without producing undefined overflow entries when width is not measured yet", () => {
    expect(buildProviderTabsLayout(OPTIONS, "qwen", WIDTHS, 0, 72)).toEqual({
      visible: [OPTIONS[3]],
      overflow: [OPTIONS[0], OPTIONS[1], OPTIONS[2]],
    });
  });
});
