# LLM 调用追踪与模型性能持久化设计

## 目标

建立完整的 LLM 调用追踪体系，持久化每次调用的性能数据（速率、token 消耗、耗时），支持模型维度的历史分析和 UI 展示。

## 背景

当前 `output_speed`（tokens/sec）在多模型后处理中实时计算并展示，但数据是临时的，无法回答"某个模型的历史平均速率"或"某个 provider 的总 token 消耗"。

`transcription_history` 上的 `token_count`/`llm_call_count` 是按转录条目累加的，丢失了模型维度信息。

## 范围

### 纳入

- 新增 `llm_call_log` 明细表，记录每次 LLM 调用
- 新增 `llm_call_stats` 聚合表，存储压缩后的历史统计
- 覆盖所有 LLM 调用场景：intent 分析、单模型 polish、多模型候选、rewrite
- 40 天明细保留策略，与 history 清理对齐
- UI：hover 当前速率时展示历史平均速率对比
- 停止向 `transcription_history.token_count`/`llm_call_count` 写入

### 不纳入

- 独立的统计页面或图表
- 润色质量评估
- 历史数据回填（旧 history 上的 token_count 不迁移）

## 数据库变更

### 新增 `llm_call_log` 明细表

```sql
CREATE TABLE IF NOT EXISTS llm_call_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    history_id INTEGER,               -- FK → transcription_history.id, nullable
    model_id TEXT NOT NULL,            -- e.g. 'gpt-4o', 'claude-sonnet-4-20250514'
    provider TEXT NOT NULL,            -- e.g. 'openai', 'anthropic'
    call_type TEXT NOT NULL,           -- 'intent' | 'single_polish' | 'multi_model' | 'rewrite'
    input_tokens INTEGER,             -- API 返回的 input token 数, nullable
    output_tokens INTEGER,            -- API 返回的 output token 数, nullable
    total_tokens INTEGER,             -- API 返回的 total token 数, nullable
    token_estimate REAL,              -- 基于字符的估算 token 数（用于速率计算）
    duration_ms INTEGER NOT NULL,     -- 调用耗时
    tokens_per_sec REAL,              -- 输出速率 (token_estimate / duration)
    error TEXT,                       -- 调用失败时的错误信息, nullable
    created_at TEXT NOT NULL           -- ISO 8601 时间戳
);
CREATE INDEX IF NOT EXISTS idx_lcl_history ON llm_call_log(history_id);
CREATE INDEX IF NOT EXISTS idx_lcl_model ON llm_call_log(model_id, provider);
CREATE INDEX IF NOT EXISTS idx_lcl_created ON llm_call_log(created_at);
CREATE INDEX IF NOT EXISTS idx_lcl_type ON llm_call_log(call_type);
```

### 新增 `llm_call_stats` 聚合表

```sql
CREATE TABLE IF NOT EXISTS llm_call_stats (
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    call_type TEXT NOT NULL,
    avg_speed REAL NOT NULL DEFAULT 0,        -- 历史平均速率 (tokens/sec)
    avg_tokens REAL NOT NULL DEFAULT 0,       -- 平均每次 token 消耗
    total_tokens INTEGER NOT NULL DEFAULT 0,  -- 累计 token 消耗
    total_calls INTEGER NOT NULL DEFAULT 0,   -- 累计调用次数
    total_errors INTEGER NOT NULL DEFAULT 0,  -- 累计错误次数
    last_updated TEXT NOT NULL,               -- ISO 8601
    PRIMARY KEY (model_id, provider, call_type)
);
```

### 停止写入的字段

`transcription_history` 上的 `token_count` 和 `llm_call_count` 停止写入。代码中将相关写入逻辑移除，改为写入 `llm_call_log`。旧数据保留，列不删除（避免 SQLite 重建表的成本）。

## 数据写入

### 写入时机

在后处理 pipeline 的每个 LLM 调用完成时写入 `llm_call_log`：

1. **Intent 分析** (`call_type = 'intent'`)：`routing.rs` 中 `analyze_intent()` 完成后
2. **单模型 polish** (`call_type = 'single_polish'`)：pipeline 单模型路径完成后
3. **多模型候选** (`call_type = 'multi_model'`)：`extensions.rs` 中每个候选模型完成后
4. **Rewrite** (`call_type = 'rewrite'`)：rewrite prompt 执行完成后

### 数据来源

| 字段                                              | 来源                                       |
| ------------------------------------------------- | ------------------------------------------ |
| `model_id`                                        | 调用时使用的模型 ID                        |
| `provider`                                        | 调用时使用的 provider                      |
| `input_tokens` / `output_tokens` / `total_tokens` | API 响应的 `usage` 字段（可能为 null）     |
| `token_estimate`                                  | 现有的 `estimate_tokens()` 函数            |
| `duration_ms`                                     | 现有的 `processing_time_ms` / elapsed 计算 |
| `tokens_per_sec`                                  | `token_estimate / duration_ms * 1000`      |
| `history_id`                                      | 转录记录 ID（在 pipeline 上下文中可用）    |

### 写入方式

新增独立的 Rust 模块 `src-tauri/src/managers/llm_metrics.rs`，提供：

```rust
pub struct LlmCallRecord {
    pub history_id: Option<i64>,
    pub model_id: String,
    pub provider: String,
    pub call_type: String,       // "intent" | "single_polish" | "multi_model" | "rewrite"
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub token_estimate: Option<f64>,
    pub duration_ms: i64,
    pub tokens_per_sec: Option<f64>,
    pub error: Option<String>,
}

/// 写入单条调用记录
pub fn log_call(conn: &Connection, record: &LlmCallRecord) -> Result<()>;

/// 查询某模型的历史平均速率（先查 stats，再结合近期明细）
pub fn get_model_avg_speed(conn: &Connection, model_id: &str, provider: &str, call_type: &str) -> Result<Option<f64>>;

/// 查询所有模型的聚合统计
pub fn get_all_model_stats(conn: &Connection) -> Result<Vec<ModelCallStats>>;
```

## 数据清理

### 策略

与 `transcription_history` 共享清理时机（应用启动时）：

1. 查询 40 天前的 `llm_call_log` 明细
2. 按 (model_id, provider, call_type) 分组聚合
3. 用加权平均合并到 `llm_call_stats`：
   - `new_avg_speed = (old_avg * old_count + batch_avg * batch_count) / (old_count + batch_count)`
   - `total_tokens += batch_total_tokens`
   - `total_calls += batch_count`
   - `total_errors += batch_error_count`
4. 删除已聚合的明细记录

### 查询历史平均速率

综合 stats 和近期明细：

```sql
-- 从 stats 获取历史聚合
SELECT avg_speed, total_calls FROM llm_call_stats
WHERE model_id = ? AND provider = ? AND call_type = ?;

-- 从近期明细获取
SELECT AVG(tokens_per_sec), COUNT(*) FROM llm_call_log
WHERE model_id = ? AND provider = ? AND call_type = ?
  AND tokens_per_sec IS NOT NULL;

-- 加权合并得到最终平均值
```

## 前端变更

### 候选面板速率 hover 提示

在 `CandidatePanel.tsx` 的速率显示（如 `42.1 t/s`）上增加 hover tooltip：

- 显示该模型的历史平均速率
- 显示本次相对历史的快慢（如 `↑12% faster` 或 `↓8% slower`）

### 数据流

1. 后端新增 Tauri command：`get_model_speed_stats`，返回各模型的平均速率
2. 前端在 review window 打开时调用一次，缓存到组件状态
3. 每个候选模型的速率与缓存的历史平均值对比，计算差异百分比

### Tooltip 展示格式

```
历史平均: 38.5 t/s (127 次)
本次: 42.1 t/s (↑9%)
```

## 架构影响

### 新增文件

- `src-tauri/src/managers/llm_metrics.rs` — 数据库操作（migration、CRUD、聚合）

### 修改文件

- `src-tauri/src/managers/history.rs` — 新增 migration；清理逻辑中加入 `llm_call_log` 清理
- `src-tauri/src/actions/post_process/extensions.rs` — 多模型完成时写入 `llm_call_log`
- `src-tauri/src/actions/post_process/routing.rs` — intent/单模型完成时写入
- `src-tauri/src/actions/post_process/pipeline.rs` — rewrite 完成时写入
- `src-tauri/src/actions/transcribe.rs` — 移除 `token_count`/`llm_call_count` 写入逻辑
- `src-tauri/src/lib.rs` — 注册新 command
- `src/review/CandidatePanel.tsx` — 速率 tooltip

### 不变文件

- `transcription_history` 表结构不变（旧列保留不删除）
- Dashboard 统计查询暂不改动（未来可切换到 `llm_call_stats`）

## 边界情况

- API 未返回 usage：`input_tokens`/`output_tokens`/`total_tokens` 为 null，`token_estimate` 和 `tokens_per_sec` 仍可用
- LLM 调用失败：记录 error 字段，`tokens_per_sec` 为 null，不计入速率平均
- 新模型首次使用：无历史数据时 tooltip 不显示对比，只显示当前速率
- 数据库写入失败：不阻断主流程，仅 log warning
