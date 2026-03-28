# 模型使用率统计增强设计

## 目标

在模型卡片上展示使用率统计数据（调用次数、token 消耗），帮助用户了解各模型的实际使用情况。

## 范围

### 纳入

- 数据库新增 `token_count` 列记录每次后处理的 token 消耗
- 从 LLM API 响应提取真实 token 数，兜底用 `tiktoken-rs` 估算
- 后端批量查询命令返回所有模型的统计
- 前端 ModelCard 展示调用次数和 token 消耗

### 不纳入

- 独立的统计页面或图表
- 按时间维度的趋势展示
- 历史数据回填

## 数据库变更

在 `transcription_history` 表新增一列：

```sql
ALTER TABLE transcription_history ADD COLUMN token_count INTEGER DEFAULT 0
```

- 新记录：从 API 响应或 tiktoken 计算得到真实值
- 历史记录：保持 0，不做回填
- 本地 ASR / 在线 ASR 记录：保持 0（不涉及 token）

## Token 计算策略

双来源，优先真实值：

1. **优先**：从 API 响应 `usage.total_tokens` 提取（OpenAI 兼容格式）
2. **兜底**：用 `tiktoken-rs` 对 prompt + response 文本计算估算值（当 API 没返回 usage 时）

两种来源都存入同一个 `token_count` 列。

## 后端变更

### `llm_client.rs`

- 从 `raw_response` 中提取 `usage.total_tokens`
- 扩展 `InferenceResult` 加 `token_count: Option<i64>` 字段
- 提取失败时返回 `None`，不阻断正常流程

### `Cargo.toml`

- 新增依赖 `tiktoken-rs`

### `post_process/pipeline.rs`

- 从 `InferenceResult` 获取 `token_count`
- 若为 `None`，用 tiktoken 对 prompt + response 文本估算
- 透传到 save 流程

### `managers/history.rs`

- `save_transcription()` 新增 `token_count: Option<i64>` 参数
- 新增 migration 添加 `token_count` 列
- 新增 `get_all_model_usage_stats()` 查询方法

### 新增命令 `commands/`

- `get_all_model_usage_stats()` Tauri command
- 返回结构：

```rust
struct ModelUsageStats {
    model_id: String,
    call_count: i64,
    total_tokens: i64,
}
```

- 两条 SQL 分别按 `asr_model` 和 `post_process_model` GROUP BY 聚合
- 前端合并结果

## 前端变更

### 展示位置：Dashboard LLM 卡片

现有概览页（Dashboard）已有 4 张摘要卡片，其中第三张是 LLM 卡片，目前展示：

- `llmCalls`：LLM 调用次数
- `llmHitRate`：LLM 命中率

在此卡片上新增 **token 消耗总量**展示，如 "12.3k tokens"。

### `DashboardSummaryCards.tsx`

- `DashboardSummary` 接口新增 `totalTokens: number` 字段
- LLM 卡片中新增一行展示 token 消耗，格式化为人类可读（k/M 单位）

### Dashboard 数据源

- 后端 Dashboard 统计查询中新增 `SUM(token_count)` 聚合
- 数据实时查询，每次打开概览页时从数据库聚合

## 边界情况

- API 无 usage 字段：用 tiktoken 估算兜底
- 计算或提取失败：token_count 记为 0，不影响主流程
- 历史记录无 token 数据：显示为 0，不做回填
