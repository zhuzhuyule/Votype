# Hotword Tag Cloud UI Redesign

## Problem

The current Hotwords tab uses a table layout with Dialog popups for editing/adding. This feels cumbersome:

- Each hotword takes a full table row — low information density
- Edit/add require opening a Dialog — extra steps
- Batch operations need checkbox selection then menu navigation
- Category filtering via SegmentedControl hides other groups

## Solution: Tag Cloud with Inline Editing

Replace the table with a tag cloud layout. All categories visible simultaneously. Click a tag to expand an inline editing panel below it — no Dialog popups.

### Scope

- **Change:** Hotwords tab only
- **Keep:** Corrections tab unchanged, all backend APIs unchanged

## Layout

```
┌─ Toolbar ──────────────────────────────────────────┐
│  [+ 添加]  [导入]  [导出]     🔍 搜索...          │
└────────────────────────────────────────────────────┘

┌─ AI 建议 (3) ──────────────────────────────────────┐
│  [OAuth 2.0] [张三] [K8s]  [全部采纳] [清除]      │
└────────────────────────────────────────────────────┘

┌─ 👤 人名 (12) ─────────────────────────────────────┐
│  [张三] [李四] [王五] [赵六] ...                   │
└────────────────────────────────────────────────────┘

┌─ 🔧 术语 (28) ─────────────────────────────────────┐
│  [Kubernetes] [OAuth 2.0] [gRPC] [微服务] ...      │
└────────────────────────────────────────────────────┘

┌─ 🏢 品牌 (5) ──────────────────────────────────────┐
│  [Anthropic] [OpenAI] [Google] ...                 │
└────────────────────────────────────────────────────┘

┌─ 🔤 缩写 (8) ──────────────────────────────────────┐
│  [LLM] [RAG] [CUDA] [RLHF] ...                    │
└────────────────────────────────────────────────────┘
```

### Inline Edit Panel (click a tag to expand)

```
┌─ 🔧 术语 (28) ─────────────────────────────────────┐
│  [Kubernetes✕] [OAuth 2.0] [gRPC] ...              │
│  ┌─ Edit Panel ─────────────────────────┐           │
│  │  原始变体: [库伯奈特斯] [K8s] [+]    │           │
│  │  类别: ●术语 ○人名 ○品牌 ○缩写       │           │
│  │  场景: ☑工作 ☑日常                    │           │
│  │  使用: 42次  |  [删除]                │           │
│  └───────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

## Interactions

### Tags

- Color coded by category (person=green, term=orange, brand=blue, abbreviation=purple)
- Hover: tooltip with variant count + use count
- Click: expand inline edit panel below; click again or click another tag to collapse
- Search filters tags in real-time (matches target and originals)

### Inline Edit Panel (replaces EditHotwordDialog)

- Originals: tag input — Enter/comma to add, click x to remove
- Category: RadioGroup inline
- Scenarios: Checkbox inline
- Stats: use count (read-only)
- Delete button with confirmation
- Auto-save on change (debounced)

### Add Bar (replaces AddHotwordDialog + BatchAddDialog)

- "添加" button expands an inline input bar below toolbar
- Text input + auto-inferred category + confirm button
- Supports comma/newline separated input for batch add
- New tags appear immediately in their category group

### AI Suggestions

- Compact tag row with category colors
- Click tag = accept (add to active hotwords)
- X button on tag = dismiss
- Bulk actions: "全部采纳" / "全部清除"

### Groups

- Auto-grouped by category, each in a collapsible section
- Group header: icon + name + count
- Empty groups hidden

## Components

### Delete

- `HotwordTable.tsx` — replaced by TagCloud
- `EditHotwordDialog.tsx` — replaced by inline panel
- `AddHotwordDialog.tsx` — replaced by inline add bar
- `BatchAddDialog.tsx` — merged into inline add bar

### Create

- `HotwordTagCloud.tsx` — main view (groups + search + suggestions)
- `HotwordTag.tsx` — single tag component
- `HotwordEditPanel.tsx` — inline edit panel
- `HotwordAddBar.tsx` — inline add input

### Modify

- `HotwordSettings.tsx` — swap HotwordTable for HotwordTagCloud, keep all data logic
