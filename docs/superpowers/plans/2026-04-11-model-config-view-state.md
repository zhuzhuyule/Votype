# Model Config View State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-processing model configuration page always show the model list and restore the user's last filter/search/grouping state from `localStorage`.

**Architecture:** Keep business settings and page view state separate. Persist model-list view preferences entirely on the frontend using a small `localStorage` schema owned by the model configuration page, hydrate those values on first render, sanitize invalid provider filters against current settings, and keep the existing page composition intact. Update the group-toggle tooltip copy only if the current translation keys are too vague.

**Tech Stack:** React 18, TypeScript, Zustand settings store, i18next, Tauri desktop frontend

---

## File Map

- Modify: `src/components/settings/post-processing/ModelsConfiguration.tsx`
  - Keep provider filter initialization/restoration logic here because this component owns the page-level provider context.
- Modify: `src/components/settings/post-processing/ModelConfigurationPanel.tsx`
  - Move toolbar state from ad hoc local defaults to hydrated + persisted view state.
- Optional modify: `src/i18n/locales/zh/translation.json`
  - Add or refine the group-toggle tooltip copy if needed.
- Optional modify: `src/i18n/locales/en/translation.json`
  - Keep English keys aligned with Chinese additions if new keys are introduced.

## Task 1: Define and Hydrate Local View State

**Files:**

- Modify: `src/components/settings/post-processing/ModelsConfiguration.tsx`
- Modify: `src/components/settings/post-processing/ModelConfigurationPanel.tsx`

- [ ] **Step 1: Add a shared localStorage key and view-state types in the model configuration components**

Add a small serializable shape for the cached page state. Keep it local to this feature.

```ts
type ModelListViewState = {
  providerFilter: string | null;
  grouped: boolean;
  sortKey: "name" | "calls" | "speed" | "provider";
  typeFilter: "all" | ModelType;
  query: string;
};

const MODEL_LIST_VIEW_STATE_KEY = "post-processing:model-list-view-state";
```

- [ ] **Step 2: Add safe read/write helpers with parse fallback**

In one of the two components, add helpers that never throw and always return a valid partial state.

```ts
function readModelListViewState(): Partial<ModelListViewState> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(MODEL_LIST_VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelListViewState>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeModelListViewState(state: ModelListViewState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      MODEL_LIST_VIEW_STATE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore quota / serialization failures for non-critical UI state.
  }
}
```

- [ ] **Step 3: Hydrate `providerFilter` in `ModelsConfiguration` from cache before falling back to current provider**

Change the initial state so cache wins, then current sidebar provider, then `null`.

```ts
const cachedViewState = useMemo(() => readModelListViewState(), []);

const [providerFilter, setProviderFilter] = useState<string | null>(() => {
  if (cachedViewState?.providerFilter !== undefined) {
    return cachedViewState.providerFilter ?? null;
  }
  return providerState.selectedProviderId || null;
});
```

- [ ] **Step 4: Sanitize stale provider IDs when settings providers load**

Add an effect in `ModelsConfiguration` to reset invalid cached provider filters.

```ts
useEffect(() => {
  if (!providerFilter) return;

  const exists = (settings?.post_process_providers ?? []).some(
    (provider) => provider.id === providerFilter,
  );

  if (!exists) {
    setProviderFilter(null);
  }
}, [providerFilter, settings?.post_process_providers]);
```

- [ ] **Step 5: Hydrate `grouped`, `sortKey`, `typeFilter`, and `query` in `ModelConfigurationPanel`**

Replace hard-coded `useState(true)`, `"name"`, `"all"`, and `""` defaults with cached values.

```ts
const cachedViewState = useMemo(() => readModelListViewState(), []);

const [sortKey, setSortKey] = useState<SortKey>(
  cachedViewState?.sortKey ?? "name",
);
const [typeFilter, setTypeFilter] = useState<"all" | ModelType>(
  cachedViewState?.typeFilter ?? "all",
);
const [query, setQuery] = useState(cachedViewState?.query ?? "");
const [grouped, setGrouped] = useState(cachedViewState?.grouped ?? true);
```

- [ ] **Step 6: Verify the code compiles locally after hydration changes**

Run:

```bash
bun tsc --noEmit
```

Expected: TypeScript exits successfully, or only shows unrelated pre-existing errors outside these files.

## Task 2: Persist Every View Interaction Immediately

**Files:**

- Modify: `src/components/settings/post-processing/ModelsConfiguration.tsx`
- Modify: `src/components/settings/post-processing/ModelConfigurationPanel.tsx`

- [ ] **Step 1: Define the canonical default state used for merging partial cache**

Use one place to define defaults so reads and writes stay consistent.

```ts
const DEFAULT_MODEL_LIST_VIEW_STATE: ModelListViewState = {
  providerFilter: null,
  grouped: true,
  sortKey: "name",
  typeFilter: "all",
  query: "",
};
```

- [ ] **Step 2: Persist `providerFilter` whenever it changes**

Add an effect in `ModelsConfiguration` that merges the current provider filter with existing cached values.

```ts
useEffect(() => {
  const nextState: ModelListViewState = {
    ...DEFAULT_MODEL_LIST_VIEW_STATE,
    ...readModelListViewState(),
    providerFilter,
  };
  writeModelListViewState(nextState);
}, [providerFilter]);
```

- [ ] **Step 3: Persist `grouped`, `sortKey`, `typeFilter`, and `query` whenever toolbar state changes**

Add a matching effect in `ModelConfigurationPanel`.

```ts
useEffect(() => {
  const nextState: ModelListViewState = {
    ...DEFAULT_MODEL_LIST_VIEW_STATE,
    ...readModelListViewState(),
    providerFilter,
    grouped,
    sortKey,
    typeFilter,
    query,
  };
  writeModelListViewState(nextState);
}, [grouped, providerFilter, query, sortKey, typeFilter]);
```

- [ ] **Step 4: Prevent grouped mode from affecting provider-specific pages**

Keep the existing behavior where grouping only applies in all-provider mode and does not break provider-scoped browsing.

```ts
const isShowingAll = !providerFilter;
const effectiveGrouped = isShowingAll ? grouped : false;

const groupedModels = useMemo(() => {
  if (!effectiveGrouped) return null;
  // existing grouping logic
}, [effectiveGrouped, filteredModels, providerNameMap]);
```

- [ ] **Step 5: Keep search-result empty state explicit when `query` is restored**

Do not change behavior, but keep the empty state copy path intact so restored searches still explain why no cards are visible.

```tsx
<Text size="2" className="text-(--gray-8)">
  {query
    ? t(
        "settings.postProcessing.models.empty.noMatch",
        "No models match your search.",
      )
    : t("settings.postProcessing.models.empty.description")}
</Text>
```

- [ ] **Step 6: Run the focused frontend validation after persistence wiring**

Run:

```bash
bun tsc --noEmit
```

Expected: No new type errors introduced by the persistence effects.

## Task 3: Refine the Group Toggle Affordance

**Files:**

- Modify: `src/components/settings/post-processing/ModelConfigurationPanel.tsx`
- Optional modify: `src/i18n/locales/zh/translation.json`
- Optional modify: `src/i18n/locales/en/translation.json`

- [ ] **Step 1: Inspect whether the current tooltip key is semantically precise enough**

Check the existing usage:

```tsx
<Tooltip
  content={t(
    "settings.postProcessing.models.sort.group",
    "Group by provider",
  )}
>
```

Decision rule:

- If the existing translation already clearly means “按提供商分组”, keep the key.
- If it reads ambiguously like “分组”, add or replace with a more explicit key/value.

- [ ] **Step 2: If needed, add explicit translation values for the tooltip**

Example translation additions:

```json
"groupByProvider": "按提供商分组"
```

```json
"groupByProvider": "Group by provider"
```

- [ ] **Step 3: Update the tooltip usage to the explicit copy if a new key is added**

```tsx
<Tooltip
  content={t(
    "settings.postProcessing.models.sort.groupByProvider",
    "Group by provider",
  )}
  delayDuration={200}
>
```

- [ ] **Step 4: Run a targeted translation shape check by parsing the JSON files**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh/translation.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/en/translation.json','utf8')); console.log('ok')"
```

Expected: `ok`

## Task 4: Final Verification and Spec Backfill

**Files:**

- Modify: `docs/specs/2026-04-11-model-config-view-state.spec.md`

- [ ] **Step 1: Run final frontend checks covering the edited files**

Run:

```bash
bun tsc --noEmit
```

Expected: No new TypeScript errors from:

- `src/components/settings/post-processing/ModelsConfiguration.tsx`
- `src/components/settings/post-processing/ModelConfigurationPanel.tsx`

- [ ] **Step 2: Manually sanity-check the runtime behavior in the app if feasible**

Run:

```bash
bun dev
```

Manual checks:

- Open the model config page and confirm the model list is immediately visible.
- Change provider, grouping, sorting, type filter, and search query.
- Navigate away and back; confirm the state restores.
- Remove or invalidate a provider from dev data if feasible; confirm fallback to `all`.

Expected: The restored view matches the cached state and invalid providers do not break the page.

- [ ] **Step 3: Backfill implementation deviations in the spec if the code diverges**

Update:

```md
## 实施偏差

| 原计划                        | 实际实现 | 原因 |
| ----------------------------- | -------- | ---- |
| localStorage 缓存全部视图状态 | ...      | ...  |
```

- [ ] **Step 4: Prepare a focused commit once verification passes**

Run:

```bash
git add docs/specs/2026-04-11-model-config-view-state.spec.md \
  docs/superpowers/plans/2026-04-11-model-config-view-state.md \
  src/components/settings/post-processing/ModelsConfiguration.tsx \
  src/components/settings/post-processing/ModelConfigurationPanel.tsx \
  src/i18n/locales/zh/translation.json \
  src/i18n/locales/en/translation.json
git commit -m "Persist model config view state"
```

Expected: A single focused commit for this feature only. Omit translation files from `git add` if they were not changed.
