import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MODEL_LIST_VIEW_STATE,
  hasStoredModelListViewState,
  MODEL_LIST_VIEW_STATE_KEY,
  normalizeModelListViewState,
  parseModelListViewState,
  sanitizeProviderFilter,
  writeModelListViewState,
} from "../src/lib/modelListViewState";

describe("modelListViewState", () => {
  test("parseModelListViewState falls back to defaults for invalid json", () => {
    expect(parseModelListViewState("{bad json")).toEqual(
      DEFAULT_MODEL_LIST_VIEW_STATE,
    );
  });

  test("normalizeModelListViewState keeps valid cached fields", () => {
    expect(
      normalizeModelListViewState({
        providerFilter: "openai",
        grouped: false,
        sortKey: "speed",
        typeFilter: "text",
        query: "gpt",
      }),
    ).toEqual({
      providerFilter: "openai",
      grouped: false,
      sortKey: "speed",
      typeFilter: "text",
      query: "gpt",
    });
  });

  test("sanitizeProviderFilter resets stale provider ids to all view", () => {
    expect(
      sanitizeProviderFilter(
        {
          providerFilter: "removed-provider",
          grouped: false,
          sortKey: "provider",
          typeFilter: "all",
          query: "claude",
        },
        ["openai", "gemini"],
      ),
    ).toEqual({
      providerFilter: null,
      grouped: false,
      sortKey: "provider",
      typeFilter: "all",
      query: "claude",
    });
  });

  test("writeModelListViewState persists the normalized payload", () => {
    let storedKey = "";
    let storedValue = "";

    writeModelListViewState(
      {
        setItem(key, value) {
          storedKey = key;
          storedValue = value;
        },
      },
      {
        providerFilter: null,
        grouped: true,
        sortKey: "name",
        typeFilter: "asr",
        query: "",
      },
    );

    expect(storedKey).toBe(MODEL_LIST_VIEW_STATE_KEY);
    expect(JSON.parse(storedValue)).toEqual({
      providerFilter: null,
      grouped: true,
      sortKey: "name",
      typeFilter: "asr",
      query: "",
    });
  });

  test("hasStoredModelListViewState detects an explicit cached all-provider view", () => {
    expect(
      hasStoredModelListViewState({
        getItem(key) {
          return key === MODEL_LIST_VIEW_STATE_KEY
            ? JSON.stringify(DEFAULT_MODEL_LIST_VIEW_STATE)
            : null;
        },
      }),
    ).toBe(true);
  });
});
