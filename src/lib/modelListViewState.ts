import type { ModelType } from "./types";

export type ModelListSortKey = "name" | "calls" | "speed" | "provider";

export type ModelListViewState = {
  providerFilter: string | null;
  grouped: boolean;
  sortKey: ModelListSortKey;
  typeFilter: "all" | ModelType;
  query: string;
};

export const MODEL_LIST_VIEW_STATE_KEY =
  "post-processing:model-list-view-state";

export const DEFAULT_MODEL_LIST_VIEW_STATE: ModelListViewState = {
  providerFilter: null,
  grouped: true,
  sortKey: "name",
  typeFilter: "all",
  query: "",
};

function isSortKey(value: unknown): value is ModelListSortKey {
  return (
    value === "name" ||
    value === "calls" ||
    value === "speed" ||
    value === "provider"
  );
}

function isTypeFilter(
  value: unknown,
): value is ModelListViewState["typeFilter"] {
  return (
    value === "all" || value === "text" || value === "asr" || value === "other"
  );
}

export function normalizeModelListViewState(
  value: unknown,
): ModelListViewState {
  if (!value || typeof value !== "object") {
    return DEFAULT_MODEL_LIST_VIEW_STATE;
  }

  const candidate = value as Partial<ModelListViewState>;

  return {
    providerFilter:
      candidate.providerFilter === null ||
      typeof candidate.providerFilter === "string"
        ? (candidate.providerFilter ?? null)
        : DEFAULT_MODEL_LIST_VIEW_STATE.providerFilter,
    grouped:
      typeof candidate.grouped === "boolean"
        ? candidate.grouped
        : DEFAULT_MODEL_LIST_VIEW_STATE.grouped,
    sortKey: isSortKey(candidate.sortKey)
      ? candidate.sortKey
      : DEFAULT_MODEL_LIST_VIEW_STATE.sortKey,
    typeFilter: isTypeFilter(candidate.typeFilter)
      ? candidate.typeFilter
      : DEFAULT_MODEL_LIST_VIEW_STATE.typeFilter,
    query:
      typeof candidate.query === "string"
        ? candidate.query
        : DEFAULT_MODEL_LIST_VIEW_STATE.query,
  };
}

export function parseModelListViewState(
  raw: string | null,
): ModelListViewState {
  if (!raw) {
    return DEFAULT_MODEL_LIST_VIEW_STATE;
  }

  try {
    return normalizeModelListViewState(JSON.parse(raw));
  } catch {
    return DEFAULT_MODEL_LIST_VIEW_STATE;
  }
}

export function sanitizeProviderFilter(
  state: ModelListViewState,
  providerIds: string[],
): ModelListViewState {
  if (!state.providerFilter) {
    return state;
  }

  if (providerIds.includes(state.providerFilter)) {
    return state;
  }

  return {
    ...state,
    providerFilter: null,
  };
}

export function readModelListViewState(storage: Pick<Storage, "getItem">) {
  return parseModelListViewState(storage.getItem(MODEL_LIST_VIEW_STATE_KEY));
}

export function hasStoredModelListViewState(storage: Pick<Storage, "getItem">) {
  return storage.getItem(MODEL_LIST_VIEW_STATE_KEY) !== null;
}

export function writeModelListViewState(
  storage: Pick<Storage, "setItem">,
  state: ModelListViewState,
) {
  storage.setItem(MODEL_LIST_VIEW_STATE_KEY, JSON.stringify(state));
}
