# Model Usage Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Dashboard LLM 卡片上展示 token 消耗总量，通过 API 响应提取或 tiktoken 估算记录每次后处理的 token 用量。

**Architecture:** 数据库新增 `token_count` 列，后端 `execute_llm_request_with_messages` 从 API 响应 `usage.total_tokens` 提取 token 数并通过返回值传播，tiktoken-rs 作为兜底估算。前端在 Dashboard 的 `calculateSummary` 中聚合 `token_count` 并在 LLM 卡片展示。

**Tech Stack:** Rust, SQLite, tiktoken-rs, React, TypeScript

---

### Task 1: 数据库 migration 新增 token_count 列

**Files:**

- Modify: `src-tauri/src/managers/history.rs:327-334` (migrations array)
- Modify: `src-tauri/src/managers/history.rs:344-368` (HistoryEntry struct)

- [ ] **Step 1: 新增 migration 30**

在 `src-tauri/src/managers/history.rs` 的 `MIGRATIONS` 数组末尾（migration 29 之后、`];` 之前）追加：

```rust
// Migration 30: Add token_count for LLM usage tracking
M::up("ALTER TABLE transcription_history ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0;"),
```

- [ ] **Step 2: 在 HistoryEntry struct 中添加字段**

在 `HistoryEntry` 的 `deleted` 字段之前添加：

```rust
pub token_count: Option<i64>,
```

- [ ] **Step 3: 更新 get_history_entries 查询**

在 `get_history_entries()` 方法（第 1479 行）的 SELECT 列表中追加 `token_count`，以及 `query_map` 闭包中的字段映射：

SELECT 列表末尾 `deleted` 前添加 `token_count`：

```sql
SELECT id, file_name, timestamp, saved, title, transcription_text, streaming_text, streaming_asr_model, post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, duration_ms, char_count, corrected_char_count, transcription_ms, language, asr_model, app_name, window_title, post_process_history, token_count, deleted FROM transcription_history ORDER BY timestamp DESC
```

在 `query_map` 闭包中 `deleted` 之前添加：

```rust
token_count: row.get("token_count")?,
```

- [ ] **Step 4: 更新 get_history_entries_paginated 查询**

对 `get_history_entries_paginated()` 方法做同样的修改——在其 SELECT 列表和 `query_map` 闭包中追加 `token_count` 字段。

- [ ] **Step 5: 编译验证**

Run: `cd src-tauri && cargo check 2>&1 | head -30`

Expected: 可能有 `token_count` 未在所有构造 `HistoryEntry` 的地方提供的编译错误——记下错误位置，后续 task 修复。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/managers/history.rs
git commit -m "Add token_count column to transcription_history (migration 30)"
```

---

### Task 2: 后端 LLM 请求提取 token 用量

**Files:**

- Modify: `src-tauri/src/actions/post_process/core.rs:154-167` (execute_llm_request_with_messages return type)
- Modify: `src-tauri/src/actions/post_process/core.rs:123-152` (execute_llm_request wrapper)
- Modify: `src-tauri/src/actions/post_process/core.rs:456-518` (response parsing)

- [ ] **Step 1: 修改 execute_llm_request_with_messages 返回类型**

将返回类型从 `(Option<String>, bool, Option<String>)` 改为 `(Option<String>, bool, Option<String>, Option<i64>)`，第四个元素是 `token_count`。

修改函数签名：

```rust
pub async fn execute_llm_request_with_messages(
    // ... 所有参数不变 ...
) -> (Option<String>, bool, Option<String>, Option<i64>) {
```

- [ ] **Step 2: 在成功响应中提取 usage.total_tokens**

在 `core.rs` 第 456 行附近，`Ok(json_resp)` 分支中，在 `return (Some(text), false, None);`（约第 518 行）之前提取 token 数：

```rust
let token_count = json_resp
    .get("usage")
    .and_then(|u| u.get("total_tokens"))
    .and_then(|t| t.as_i64());
return (Some(text), false, None, token_count);
```

- [ ] **Step 3: 更新所有错误返回路径**

函数中所有其他 `return` 语句添加第四个元素 `None`：

- 第 246-256 行（client 创建失败）：`return (None, true, Some(detail), None);`
- 第 280 行（messages 为空）：`return (None, false, None, None);`
- 第 533 行（JSON 解析失败）：`return (None, true, Some(detail), None);`
- 第 551 行（HTTP 状态码错误）：`return (None, true, Some(detail), None);`
- 第 554-576 行（网络错误）：`return (None, true, Some(detail), None);`
- 函数末尾的 Err 分支：`(None, true, Some(detail), None)`

- [ ] **Step 4: 更新 execute_llm_request wrapper**

`execute_llm_request`（第 123 行）直接透传新返回类型，不需要额外修改签名和实现，因为它只是调用 `execute_llm_request_with_messages` 并返回结果。将其返回类型也改为 `(Option<String>, bool, Option<String>, Option<i64>)`。

- [ ] **Step 5: 编译验证**

Run: `cd src-tauri && cargo check 2>&1 | head -30`

Expected: 编译错误出现在 `pipeline.rs` 中调用 `execute_llm_request_with_messages` 解构返回值的地方——这是预期的，在 Task 3 修复。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs
git commit -m "Extract token_count from LLM API response usage field"
```

---

### Task 3: 添加 tiktoken-rs 依赖并实现估算兜底

**Files:**

- Modify: `src-tauri/Cargo.toml` (新增依赖)
- Modify: `src-tauri/src/actions/post_process/pipeline.rs` (解构修复 + tiktoken 估算)

- [ ] **Step 1: 添加 tiktoken-rs 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 部分添加：

```toml
tiktoken-rs = "0.6"
```

- [ ] **Step 2: 修复 pipeline.rs 中的解构**

在 `pipeline.rs` 第 95 行附近，将解构从：

```rust
let (result, err, error_message) = super::core::execute_llm_request_with_messages(
```

改为：

```rust
let (result, err, error_message, api_token_count) = super::core::execute_llm_request_with_messages(
```

对第 953 行附近的另一处调用做同样修改。

- [ ] **Step 3: 在 pipeline 中实现 tiktoken 兜底估算**

在每处 `execute_llm_request_with_messages` 调用返回后，计算最终 token_count：

```rust
let token_count: i64 = api_token_count.unwrap_or_else(|| {
    // Fallback: estimate tokens using tiktoken cl100k_base
    let bpe = tiktoken_rs::cl100k_base().unwrap();
    let prompt_tokens = bpe.encode_with_special_tokens(&final_prompt_text).len() as i64;
    let response_tokens = result.as_ref().map(|r| bpe.encode_with_special_tokens(r).len() as i64).unwrap_or(0);
    prompt_tokens + response_tokens
});
```

注意：`final_prompt_text` 需要是发送给 LLM 的完整 prompt 文本。根据上下文找到合适的变量名（在第一处调用点是 system_prompts + user_message 拼接，在第二处同理）。

- [ ] **Step 4: 将 token_count 通过 maybe_post_process_transcription 返回值传播**

将 `maybe_post_process_transcription` 的返回类型从：

```rust
(Option<String>, Option<String>, Option<String>, bool, Option<String>)
```

改为：

```rust
(Option<String>, Option<String>, Option<String>, bool, Option<String>, Option<i64>)
```

第六个元素是 `token_count`。所有返回路径（无后处理、跳过、错误等）在末尾追加 `None` 或计算出的 `Some(token_count)`。

- [ ] **Step 5: 编译验证**

Run: `cd src-tauri && cargo check 2>&1 | head -30`

Expected: 编译错误出现在 `transcribe.rs` 中调用 `maybe_post_process_transcription` 解构的地方。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Add tiktoken-rs fallback for token estimation in post-process pipeline"
```

---

### Task 4: transcribe.rs 传播 token_count 到 history

**Files:**

- Modify: `src-tauri/src/actions/transcribe.rs` (解构修复 + 传递 token_count)
- Modify: `src-tauri/src/managers/history.rs` (update_transcription_post_processing 新增参数)

- [ ] **Step 1: 修复 transcribe.rs 解构**

在 `transcribe.rs` 第 1414 行附近，将解构从：

```rust
let (processed_text, model, prompt_id, err, error_message) =
    maybe_post_process_transcription(...)
```

改为：

```rust
let (processed_text, model, prompt_id, err, error_message, token_count) =
    maybe_post_process_transcription(...)
```

在所有调用 `maybe_post_process_transcription` 的地方做同样修改。

- [ ] **Step 2: 修改 update_transcription_post_processing 签名**

在 `src-tauri/src/managers/history.rs` 的 `update_transcription_post_processing`（第 1236 行）新增参数：

```rust
pub async fn update_transcription_post_processing(
    &self,
    id: i64,
    post_processed_text: String,
    post_process_prompt: String,
    prompt_name: String,
    post_process_prompt_id: Option<String>,
    post_process_model: Option<String>,
    token_count: Option<i64>,        // 新增
) -> Result<()> {
```

- [ ] **Step 3: 在 UPDATE SQL 中写入 token_count**

在 `update_transcription_post_processing` 方法的 SQL 语句中追加 `token_count`：

```rust
conn.execute(
    "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2, post_process_prompt_id = ?3, post_process_model = ?4, corrected_char_count = ?5, post_process_history = ?6, token_count = COALESCE(token_count, 0) + COALESCE(?8, 0) WHERE id = ?7",
    params![post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, corrected_char_count, history_json, id, token_count],
)?;
```

注意使用 `COALESCE(token_count, 0) + COALESCE(?8, 0)` 来累加——因为一条记录可能经过多轮后处理。

- [ ] **Step 4: 在所有 transcribe.rs 的 update_transcription_post_processing 调用中传递 token_count**

在第 1562 行和 1615 行附近的调用中追加 `token_count` 参数（或 `None`）。

- [ ] **Step 5: 修复其他调用点**

`update_transcription_post_processing` 还在 `commands/history.rs`（3 处）和 `commands/mod.rs`（3 处）被调用。这些是手动重跑后处理的命令，暂时传 `None` 作为 `token_count`。

- [ ] **Step 6: 编译验证**

Run: `cd src-tauri && cargo check 2>&1 | head -30`

Expected: PASS（或仅前端类型不匹配的警告）。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/actions/transcribe.rs src-tauri/src/managers/history.rs src-tauri/src/commands/history.rs src-tauri/src/commands/mod.rs
git commit -m "Propagate token_count through pipeline to history storage"
```

---

### Task 5: 前端展示 token 消耗

**Files:**

- Modify: `src/components/settings/dashboard/Dashboard.tsx` (calculateSummary 聚合)
- Modify: `src/components/settings/dashboard/DashboardSummaryCards.tsx` (DashboardSummary 接口 + LLM 卡片)
- Modify: `src/i18n/locales/en/translation.json` (新增 i18n key)
- Modify: `src/i18n/locales/zh/translation.json` (新增 i18n key)

- [ ] **Step 1: 在 DashboardSummary 接口中新增 totalTokens**

在 `DashboardSummaryCards.tsx` 的 `DashboardSummary` 接口中添加：

```typescript
interface DashboardSummary {
  // ... 现有字段 ...
  totalTokens: number;
}
```

- [ ] **Step 2: 在 calculateSummary 中聚合 token_count**

在 `Dashboard.tsx` 的 `calculateSummary` 函数中：

初始化变量：

```typescript
let totalTokens = 0;
```

在 for 循环中累加：

```typescript
totalTokens += (entry as any).token_count ?? 0;
```

在 return 对象中添加：

```typescript
return {
  // ... 现有字段 ...
  totalTokens,
};
```

注意：`HistoryEntry` 的 TypeScript 类型可能也需要更新以包含 `token_count`。检查 `src/lib/types.ts` 中是否有 HistoryEntry schema 并添加 `token_count: z.number().optional()`。

- [ ] **Step 3: 在 LLM 卡片中展示 token 总量**

在 `DashboardSummaryCards.tsx` 的 LLM 卡片（CpuIcon 那张）中，将现有的单行描述替换为两行：

```tsx
{
  /* LLM Card - Brain */
}
<PremiumCard
  gradientFrom="rgba(147, 51, 234, 0.05)"
  gradientTo="rgba(147, 51, 234, 0.12)"
  pattern={<CpuIcon color="#9333ea" />}
>
  <Flex justify="between" align="center">
    <Text
      size="1"
      weight="medium"
      className="uppercase tracking-wider opacity-50"
    >
      {t("dashboard.summary.llm.title")}
    </Text>
    {trends && <TrendIndicator value={trends.llmCalls} />}
  </Flex>
  <Heading size="7" weight="bold" className="tracking-tight tabular-nums">
    {numberFormat.format(summary.llmCalls)}
  </Heading>
  <Flex direction="column" gap="0">
    <Text size="2" className="opacity-60">
      {t("dashboard.summary.llm.details", {
        hitRate: `${(summary.llmHitRate * 100).toFixed(1)}%`,
      })}
    </Text>
    {summary.totalTokens > 0 && (
      <Text size="2" className="opacity-60 tabular-nums">
        {t("dashboard.summary.llm.tokens", {
          count:
            summary.totalTokens >= 1_000_000
              ? `${(summary.totalTokens / 1_000_000).toFixed(1)}M`
              : summary.totalTokens >= 1_000
                ? `${(summary.totalTokens / 1_000).toFixed(1)}k`
                : `${summary.totalTokens}`,
        })}
      </Text>
    )}
  </Flex>
</PremiumCard>;
```

- [ ] **Step 4: 添加 i18n keys**

在 `src/i18n/locales/en/translation.json` 的 `dashboard.summary.llm` 下添加：

```json
"tokens": "{{count}} tokens consumed"
```

在 `src/i18n/locales/zh/translation.json` 的 `dashboard.summary.llm` 下添加：

```json
"tokens": "消耗 {{count}} tokens"
```

- [ ] **Step 5: 前端格式校验**

Run: `bun format`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/dashboard/Dashboard.tsx src/components/settings/dashboard/DashboardSummaryCards.tsx src/i18n/locales/en/translation.json src/i18n/locales/zh/translation.json
git commit -m "Display token consumption on Dashboard LLM card"
```

---

### Task 6: 全量验证

**Files:**

- Verify only

- [ ] **Step 1: Rust 编译和测试**

Run: `cd src-tauri && cargo check && cargo test --lib`

Expected: PASS

- [ ] **Step 2: 前端格式校验**

Run: `bun format`

Expected: PASS

- [ ] **Step 3: 前端构建验证**

Run: `bun build`

Expected: PASS
