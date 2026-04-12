# OpenAI-Compatible Key Failover Gateway

**Date:** 2026-04-11
**Status:** Draft

## Intent

1. 将当前项目内分散的 provider 调用收口到统一执行入口，任何模型请求都必须通过统一的 Key 获取与失败处理机制执行。
2. 对每个 provider 的多 Key 行为建立确定规则：轮询取 Key、单次请求内失败切换、按错误类型冷却、仅在本次请求允许尝试的 Key 全部失败时才返回错误并触发告警。
3. 为未来对外开放的 OpenAI-compatible API 预留稳定底座，使桌面端内部调用与外部 API 共享同一套模型解析、Key 调度、错误归类与观测逻辑。

## Constraints

- 北向协议采用 OpenAI-compatible；不在第一版引入自定义 API 协议。
- 第一版对外模型集合直接来自 `cached_models`；不新增稳定别名模型层。
- 第一版严格绑定单个 `cached_model` 执行；只允许在该模型对应 provider 的 Key 池内 failover，不允许跨 provider 或跨 model fallback。
- 任何 provider 请求禁止继续直接使用 `first_key()`；必须通过统一 Key 调度入口。
- 单个 Key 失败不得立刻触发用户可见错误或 DA 报警；只有“当前请求已穷尽允许尝试的 Key”时才能抛出最终错误。
- 错误分类必须可判定“换 Key 是否有意义”；无意义的错误不得进入 failover。
- 与现有 `cached_models`、`post_process_providers`、`SecretKeyRing`、`KeySelector` 兼容演进，避免推翻已有数据结构。

---

## Design

### 1. 北向接口目标

未来开放接口保持 OpenAI-compatible，第一版至少覆盖：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/audio/transcriptions`

这些接口的职责仅包括：

- 外部访问鉴权
- 请求格式校验
- 将 `model` 解析到现有 `cached_model`
- 将执行委托给统一执行网关
- 返回标准化响应与错误

北向接口本身不直接处理 Key 轮询与 provider 健康状态；这些逻辑必须下沉到统一执行层。

### 2. 模型解析策略

第一版不引入新的“逻辑模型名”。对外暴露的模型列表直接由 `cached_models` 生成，调用时传入的 `model` 必须严格命中单个 `cached_model`。

为避免 `cached_model.id` 与 `cached_model.model_id` 混用导致歧义，第一版北向 API 的公共契约明确如下：

- `/v1/models` 返回的 `id` 固定使用 `cached_model.id`
- 外部请求体中的 `model` 字段也必须传 `cached_model.id`
- `cached_model.model_id` 仅作为内部真实上游模型名使用，不对外作为唯一标识暴露
- 执行层解析流程固定为：`request.model -> cached_model.id -> (provider_id, model_id)`

解析结果固定为：

- `cached_model.id`
- `cached_model.model_id`
- `cached_model.provider_id`
- 对应 `PostProcessProvider`

一旦解析成功，后续执行语义必须保持稳定：

- 请求的模型是谁，就只执行这个模型
- 不因某个 Key 失败而切换到别的模型
- 不因某个 provider 故障而跳到别的 provider

这样可以保证 OpenAI-compatible 语义可预测，日志与用户理解也更一致。

### 3. 统一执行网关

新增统一执行抽象 `ExecutionGateway`，任何文本模型、音频模型、技能路由、意图路由等 provider 调用都必须经过它。

统一执行入口的职责：

1. 解析 `model` 到唯一的 `(cached_model, provider)`
2. 根据 provider 从 `KeyPool` 获取当前请求可用的下一个 Key
3. 发起请求
4. 将结果反馈给 `KeyPool`
5. 若错误允许 failover，则尝试下一个 Key
6. 若本次请求穷尽允许尝试次数，则返回最终错误并触发 provider 级 incident

建议内部 API 形态：

```rust
pub struct ExecutionPlan {
    pub provider_id: String,
    pub cached_model_id: String,
    pub remote_model_id: String,
    pub request_kind: RequestKind,
}

pub enum ExecutionOutcome<T> {
    Success(T),
    Exhausted(ExhaustedProviderError),
    Fatal(FatalRequestError),
}

pub async fn execute_with_failover<T>(
    app: &AppHandle,
    settings: &AppSettings,
    plan: ExecutionPlan,
    attempt: impl Fn(&str) -> Pin<Box<dyn Future<Output = AttemptResult<T>> + Send>>,
) -> ExecutionOutcome<T>
```

这里的 `attempt` 接受实际 API key，由具体调用点提供请求构造细节，但 Key 获取、尝试次数、状态回写、最终错误归并必须由统一执行层负责。

### 4. KeyPool / KeySelector 升级

现有 `KeySelector` 已支持基础轮询与 cooldown，但需要升级为“请求级 failover 调度器”，而不只是“取下一个 Key”。

每个 provider 的运行态建议维护：

```rust
struct ProviderKeyState {
    cursor: usize,
    cooldowns: Vec<Option<Instant>>,
    consecutive_failures: Vec<u32>,
    last_error_code: Vec<Option<u16>>,
    last_used_at: Vec<Option<Instant>>,
    last_success_at: Vec<Option<Instant>>,
}
```

必备行为：

- `acquire_next_key(provider_id, keys, attempted_indices)`：按轮询顺序返回下一个本次请求尚未尝试的 Key，优先选择健康 Key；若健康 Key 为 0，可按兜底规则返回一个冷却中但最早恢复的 Key
- `report_success(provider_id, key_index)`：清空失败计数，记录最后成功时间
- `report_error(provider_id, key_index, classified_error)`：按错误类型更新失败计数、错误码、冷却时间
- `reset(provider_id)`：当 Key 列表被修改时清空运行态

`attempted_indices` 是关键输入。这样可以保证单次请求内不会重复尝试同一个 Key，也能将“全局轮询顺序”和“请求内 failover 顺序”统一起来。

### 5. 单次请求的 failover 规则

第一版采用“有上限的健康 Key 轮询尝试”，并保留一次“全部冷却时的兜底尝试”：

```text
max_attempts_per_request = min(healthy_key_count, 3)
```

具体行为：

1. 先统计当前 provider 下启用、非空、未被永久禁用的 Key，并区分：
   - `healthy keys`：当前未处于 cooldown
   - `cooled-down keys`：当前仍处于 cooldown
2. 若 `healthy_key_count > 0`，则本次请求最多尝试 `min(healthy_key_count, 3)` 个健康 Key
3. 若 `healthy_key_count == 0`，但存在启用 Key，则允许额外进行 `1` 次兜底尝试：
   - 选择当前仍处于 cooldown、但 `cooldown_until` 最早到期的那个 Key
   - 该兜底 Key 仅在本次请求中尝试一次，不再继续轮转其他 cooldown Key
4. 跳过本次请求已尝试过的 Key
5. 按轮询 cursor 取下一个符合条件的 Key
6. 调用失败后，若错误允许 failover，则继续尝试下一个 Key
7. 成功即结束
8. 达到最大尝试次数或无可用 Key 时，结束为 provider exhausted

采用上限 `3` 的原因：

- 能覆盖“连续三个 Key 都出错”的主要场景
- 避免 provider 配置了很多 Key 时，一次失败链路被拉得过长
- 为 UI 响应时间和外部 API 超时保留可控上界

### 6. 错误分类与冷却策略

统一执行层必须先对错误分类，再决定是否切换 Key。

#### 允许切换到下一个 Key 的错误

- `429`
- `401`
- `403`
- 网络连接错误
- 上游超时
- provider `5xx`

这些错误代表当前 Key 或当前 provider 通路临时不可用，换 Key 仍有机会成功。

#### 不允许切换 Key、直接失败的错误

- `400`
- `404`
- 模型不存在
- 请求体格式错误
- 本地请求构造错误
- 本地响应解析错误

这些错误与 Key 无关，继续切 Key 只会放大无效请求与等待时间。

#### 建议冷却时间

- `429` -> `60s`
- `401/403` -> `300s`
- 网络错误 / 超时 / `5xx` -> `30s`
- 成功后清空该 Key 的 `consecutive_failures`

### 7. Provider 级 incident 与告警策略

告警必须分层，避免单 Key 抖动造成噪音。

#### Key 级事件

记录到日志和 metrics，但不直接提示用户：

- 某 Key 被选中
- 某 Key 成功
- 某 Key 因 `429/401/403/timeout/5xx` 进入 cooldown

#### Provider 级 incident

仅在下面任一条件满足时触发用户可见错误与 DA 报警：

- 本次请求的 `max_attempts_per_request` 已全部失败
- 或 `60s` 时间窗口内同一 provider 连续出现 `3` 次 exhausted

用户与外部 API 调用方看到的最终错误应是：

- 该模型对应 provider 当前不可用
- 并附带最后一次可归因的错误摘要

而不是暴露“第几个 Key 失败了什么”的内部细节。

### 8. 与现有代码的改造原则

以下调用点必须逐步迁移到统一执行网关，不再直接 `first_key()`：

- `src-tauri/src/actions/post_process/core.rs`
- `src-tauri/src/actions/post_process/extensions.rs`
- `src-tauri/src/actions/post_process/routing.rs`
- `src-tauri/src/actions/transcribe.rs`
- `src-tauri/src/managers/hotword.rs`
- 未来新增的 OpenAI-compatible 网关入口

迁移原则：

- 先统一“Key 获取 + 错误回写”协议
- 再统一“请求级 failover”
- 最后再暴露北向 API

这样可以让桌面端内部先复用稳定机制，再开放外部能力，减少两套实现分叉。

### 9. `/v1/models` 的生成策略

对外模型列表直接由 `cached_models` 生成，字段至少包含：

- `id`
- `object`
- `created`
- `owned_by`

内部还需要保留不可见或扩展元数据，用于执行与观测：

- `provider_id`
- `remote_model_id`
- `model_type`
- `supports_streaming`
- `enabled`

但第一版 OpenAI-compatible 输出以兼容标准字段为主，不把 provider 内部实现细节暴露为公共契约。

### 10. 排序后的实施顺序

为了降低风险，建议按下面顺序实施：

1. 将 `KeySelector` 升级为支持请求级 failover 的 `KeyPool`
2. 抽取统一执行入口，先接入 `core.rs` 与 `extensions.rs`
3. 清理 `routing.rs`、`transcribe.rs`、`hotword.rs` 的 `first_key()` 读取
4. 增加 provider exhausted 错误与告警事件
5. 最后新增 OpenAI-compatible 北向 API，并复用同一执行层

---

## Boundaries

### Allowed Files

- `src-tauri/src/key_selector.rs` — 升级为请求级 KeyPool / failover 调度
- `src-tauri/src/settings.rs` — 如有必要补充 Key 运行态相关类型或配置项
- `src-tauri/src/actions/post_process/core.rs` — 接入统一执行入口
- `src-tauri/src/actions/post_process/extensions.rs` — 接入统一执行入口
- `src-tauri/src/actions/post_process/routing.rs` — 移除 `first_key()` 直读
- `src-tauri/src/actions/transcribe.rs` — 移除 `first_key()` 直读
- `src-tauri/src/managers/hotword.rs` — 移除 `first_key()` 直读
- `src-tauri/src/lib.rs` — 注册新的 managed state 或北向 API 命令
- `src-tauri/src/commands/` 或新增网关模块 — 暴露 OpenAI-compatible 入口
- `docs/superpowers/plans/` — 对应实施计划

### Forbidden

- 第一版禁止引入跨 provider fallback
- 第一版禁止引入跨 model fallback
- 第一版禁止新增“逻辑模型别名层”
- 不修改 prompt 内容与提示词逻辑
- 不重写现有 post-process pipeline 的业务语义
- 不改变 review window 行为

## Out of Scope

- 外部 API 的计费、租户、配额管理
- 对外 API Key 的完整管理后台
- 跨 provider 的智能路由
- 将多个 provider 聚合成单一逻辑模型别名
- stream 模式、responses API、embeddings API 的完整覆盖
- provider 级长期熔断器与自动恢复策略

## Acceptance Scenarios

### 1. provider_key_failover_happy_path

- **Given**: 某 provider 绑定 3 个启用 Key，目标 `cached_model` 指向该 provider
- **When**: 请求命中第 1 个 Key 且调用成功
- **Then**: 请求立即成功返回，轮询游标推进，且不触发告警

### 2. provider_key_failover_after_transient_error

- **Given**: 某 provider 绑定 3 个启用 Key，第 1 个 Key 返回 `429`，第 2 个 Key 正常
- **When**: 同一个请求执行
- **Then**: 系统记录第 1 个 Key 进入冷却，自动切换第 2 个 Key 重试，并最终成功返回

### 3. provider_key_exhausted_error_path

- **Given**: 某 provider 有 3 个健康 Key，本次请求的前三次尝试分别返回 `401`、超时、`503`
- **When**: 同一个请求执行到最大尝试次数
- **Then**: 系统返回 provider exhausted 错误，触发一次 provider 级 incident，并且不再继续尝试更多 Key

### 4. non_failover_error_stops_immediately

- **Given**: 某 provider 有多个健康 Key，请求参数无效导致上游返回 `400`
- **When**: 请求执行
- **Then**: 系统立即返回 fatal request error，不切换到其他 Key，也不将此错误计入 provider exhausted

### 5. single_available_key_edge_case

- **Given**: 某 provider 仅有 1 个启用且健康 Key
- **When**: 请求执行且该 Key 返回 `429`
- **Then**: 系统只尝试这 1 个 Key，并返回 exhausted 错误，不会进入无意义的额外重试

### 6. all_keys_in_cooldown_fallback_edge_case

- **Given**: 某 provider 的所有启用 Key 当前都处于 cooldown，且至少存在 1 个 Key
- **When**: 新请求到来
- **Then**: 系统只选择 `cooldown_until` 最早到期的那个 Key 做 1 次兜底尝试；若仍失败，则返回 exhausted 错误

### 7. cached_model_strict_binding_edge_case

- **Given**: 外部请求传入的 `model` 已解析为某个 `cached_model`
- **When**: 该模型对应 provider 的全部允许尝试 Key 失败
- **Then**: 系统只返回该模型的 provider 不可用错误，不自动切换到其他 provider 或其他模型

## Implementation Deviations

> 功能完成后填写。记录实际实现与本设计的差异。

| Original Plan | Actual Implementation | Reason |
| ------------- | --------------------- | ------ |
| —             | —                     | —      |
