---
name: "模型 Fallback 链"
tags: [fallback, model-chain, availability, asr, llm]
depends_on: [unified-routing-pipeline, model-cache]
estimate: "3-5 天"
---

## 意图

"为所有模型选择点引入 Fallback 链机制，确保单个模型 API 调用失败时自动切换到备选模型，消除单点故障，保障系统整体可用性。"

当前所有模型选择点（意图模型、润色模型、ASR 在线模型等）均为单选，一旦所选模型的 API 调用失败（网络错误、超时、rate limit、服务不可用），该次任务直接失败。用户需要手动切换模型重试，体验差且打断工作流。

本次改造让每个选择点支持配置一个备选模型，失败时自动切换执行，对用户静默透明。

## 约束

- 必须向后兼容：旧版 settings 中的纯 string 模型 ID 字段能自动迁移为 `ModelChain` 结构
- 未配置备选模型时，行为与现有完全一致
- Fallback 执行逻辑统一封装，所有选择点共用，不各自实现
- 不改变现有多模型比较（Multi-Model）功能的行为，两者独立
- ASR 在线模型的备选仅限在线模型，不包含本地模型（本地 fallback 已有独立机制）
- 初期 `staggered_delay_ms` 写死 2000ms，不暴露配置项
- 遵守 CLAUDE.md 中的 runtime rules（不在非 async 上下文中使用 `tokio::spawn` 等）

## 已定决策

### 1. 数据结构：ModelChain

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct ModelChain {
    pub primary_id: String,
    pub fallback_id: Option<String>,
    pub strategy: ModelChainStrategy,
}

#[derive(Serialize, Deserialize, Clone)]
pub enum ModelChainStrategy {
    Serial,     // 主模型失败后才调备选
    Staggered,  // 主模型先跑，2s 无响应则备选也启动，取先完成的
    Race,       // 同时发起，取最快
}
```

TypeScript 侧对应：

```typescript
interface ModelChain {
  primary_id: string;
  fallback_id: string | null;
  strategy: "serial" | "staggered" | "race";
}
```

**原因**：`ModelChain` 是最小化的抽象，只增加一个备选和一个策略字段，不过度设计。不用有序列表是因为实际场景中主+备选足够，更多层 fallback 增加复杂度但收益有限。

### 2. 两套交互方式

**LLM 模型（Settings 页）**：统一大弹窗，左键设主模型，右键设备选。

- 收起状态展示主模型名，下方浅色小字显示备选模型 + 策略标签
- 点击区域打开弹窗，弹窗内按 Provider 分组
- 左键点击模型 → 设为主模型（● 高亮标记）
- 右键点击模型 → 设为备选（○ 次级标记）
- 点已选模型对应操作 → 取消选择
- 有备选时弹窗底部显示策略 Pill 按钮（串行 / 延迟 / 竞速）

**ASR 在线模型（Footer）**：轻量级，主模型旁加 `+ 备用` 入口。

- 主模型保持现有 Dropdown
- 旁边显示 `+ 备用` 虚线框（仅在有 ≥2 个在线 ASR 模型时可见）
- 点击虚线框 → 底部弹出 Popover，列出在线 ASR 模型（排除已选主模型）
- 选中后虚线框变实体：模型名 + 策略标签 + ✕ 清除
- Popover 底部附策略 Pill 按钮

**原因**：Footer 空间有限，适合轻量交互；Settings 页有充足空间，统一大弹窗体验更好。两者共用 `ModelChain` 数据结构，仅 UI 层不同。

### 3. Fallback 策略默认值

| 选择点       | 默认策略  | 原因                                     |
| ------------ | --------- | ---------------------------------------- |
| 意图模型     | serial    | 意图分类延迟敏感，串行失败快             |
| 轻量润色模型 | serial    | 同上                                     |
| 长文本模型   | staggered | 长文本处理耗时，延迟启动备选提升可用性   |
| 主润色模型   | staggered | 同上                                     |
| ASR 在线模型 | serial    | ASR 调用有音频上传，避免重复上传浪费带宽 |

### 4. 统一执行函数

所有选择点的 fallback 执行统一走一个 `execute_with_fallback()` 函数，不在各处分别实现。

```rust
// 伪代码，实际签名根据实现调整
pub async fn execute_with_fallback(
    chain: &ModelChain,
    execute_fn: impl Fn(model_id) -> Result<R, String>,
) -> FallbackResult<R>

pub struct FallbackResult<R> {
    pub result: R,
    pub actual_model_id: String,   // 实际执行的模型 ID
    pub is_fallback: bool,         // 是否使用了备选模型
    pub primary_error: Option<String>, // 主模型失败时的错误信息
}
```

**取消语义**：Staggered/Race 策略下，先完成的结果被采用后，另一个任务通过 drop future 停止等待响应。这不会中止服务端已开始的处理，但可以释放本地资源。

### 5. ASR Fallback 与现有本地 Fallback 的关系

当前已有 `post_process_use_local_candidate_when_online_asr` 机制（在线 ASR 超时后用本地结果）。新增的在线备选模型与此机制的优先级：

1. **先走在线 Fallback 链**：主在线模型失败 → 备选在线模型
2. **在线都失败后，再走本地 Fallback**：如果本地 fallback 已启用，使用本地结果
3. 两个机制独立，互不影响各自的配置

即：在线备选是 "同层替换"，本地 fallback 是 "降级兜底"。

### 6. ASR Race/Staggered 下的音频重复上传

用户手动将 ASR fallback 策略切换为 race 或 staggered 时，音频会同时上传到两个 provider。这是预期行为 — 用户主动选择用带宽换速度/可用性。默认策略 serial 不会有此问题。

### 7. 向后兼容：自定义反序列化

Settings 中原本存储 `"post_process_intent_model_id": "some-id"` 的字段，新版改为存储 `ModelChain` 对象。反序列化时通过 serde 的 `#[serde(deserialize_with)]` 或 `untagged` enum 实现兼容：

- 读到 string → 转为 `ModelChain { primary_id: value, fallback_id: None, strategy: Serial }`
- 读到 object → 正常解析为 `ModelChain`
- 读到 null / 缺失 → `None`（未配置，行为同现有）

## 边界

### 允许修改

**后端（Rust）：**

- `src-tauri/src/settings.rs` — ModelChain 类型定义、settings 字段迁移、反序列化兼容
- `src-tauri/src/actions/post_process/pipeline.rs` — 接入 fallback 执行
- `src-tauri/src/actions/post_process/routing.rs` — 意图模型调用接入 fallback
- `src-tauri/src/actions/post_process/core.rs` — 添加 `execute_with_fallback()` 函数
- `src-tauri/src/actions/post_process/extensions.rs` — 长文本模型调用接入 fallback
- `src-tauri/src/actions/transcribe.rs` — ASR 在线模型调用接入 fallback
- `src-tauri/src/online_asr.rs` — 可能需要调整以支持 fallback 调用签名
- `src-tauri/src/actions/post_process/manual.rs` — 直接润色调用接入 fallback
- `src-tauri/src/managers/llm_metrics.rs` — 记录实际使用的模型（fallback 标记）

**前端（TypeScript/React）：**

- `src/lib/types.ts` — ModelChain 类型定义
- `src/components/settings/post-processing/IntentModelSelection.tsx` — 改用 ModelChain 选择器
- `src/components/settings/post-processing/LengthRoutingSettings.tsx` — 改用 ModelChain 选择器
- `src/components/settings/post-processing/PromoteModelSelection.tsx` — 改用 ModelChain 选择器
- `src/components/settings/post-processing/PostProcessingPanel.tsx` — 集成新弹窗
- `src/components/model-selector/ModelDropdown.tsx` — ASR 备用模型 UI
- `src/stores/settingsStore.ts` — ModelChain 相关 actions
- `src/i18n/locales/` — 新增翻译 key

### 禁止

- 不修改现有多模型比较功能（Multi-Model）的数据结构和执行逻辑
- 不暴露 `staggered_delay_ms` 配置项给用户
- 不在 ASR 备选中混入本地模型（本地 fallback 已有独立机制 `post_process_use_local_candidate_when_online_asr`）
- 不添加超过 1 个备选模型（初期保持主+备选，不做链式多级 fallback）

## 排除范围

- **智能推荐**：基于历史指标（速度、失败率）自动推荐备选模型 — 后续迭代
- **自动禁用不可靠模型**：频繁失败的模型标记为不可靠 — 后续迭代
- **模型速度/体积展示**：在选择器中显示模型性能指标 — 后续迭代
- **Staggered delay 可配置**：写死 2000ms，后续按需开放
- **多级 Fallback 链**：主+备选 2 个足够，不做 3 个以上
- **本地 ASR 模型的 Fallback**：本地模型不会 API 失败，无需 fallback
- **Skill 路由模型 Fallback**：scope 较小，可后续单独加

## 验收场景

### 1. llm_serial_fallback_on_failure (Happy path)

- **Given**: 意图模型配置了 ModelChain，primary = ModelA，fallback = ModelB，strategy = serial
- **When**: ModelA API 调用返回网络错误
- **Then**: 自动调用 ModelB 执行相同请求，返回 ModelB 的结果，结果中标注 `actual_model_id = ModelB`

### 2. llm_staggered_primary_slow (Happy path)

- **Given**: 主润色模型配置了 ModelChain，strategy = staggered
- **When**: 主模型 2s 内未返回
- **Then**: 备选模型也被启动，先完成的结果被采用，另一个请求被取消

### 3. llm_race_fastest_wins (Happy path)

- **Given**: 长文本模型配置了 ModelChain，strategy = race
- **When**: 执行润色请求
- **Then**: 两个模型同时调用，先返回的结果被采用

### 4. no_fallback_configured (Happy path)

- **Given**: 某选择点的 ModelChain 中 fallback_id = null
- **When**: 主模型 API 调用失败
- **Then**: 行为与现有一致，返回错误，不做额外重试

### 5. asr_online_fallback (Happy path)

- **Given**: ASR 在线模型配置了备选模型，strategy = serial
- **When**: 主 ASR 模型超时或返回错误
- **Then**: 自动切换到备选 ASR 模型重新转写，用户无感知

### 6. both_models_fail (Error path)

- **Given**: 配置了 fallback，strategy = serial
- **When**: 主模型和备选模型都失败
- **Then**: 返回最后一个错误信息给用户，同现有错误展示方式

### 7. staggered_both_return (Edge case)

- **Given**: strategy = staggered，备选已启动
- **When**: 主模型在备选之后返回结果
- **Then**: 采用先到的（备选的）结果，主模型结果被丢弃

### 8. settings_migration (Edge case)

- **Given**: 用户从旧版本升级，settings 中 `post_process_intent_model_id` 存储为纯字符串 `"abc"`
- **When**: 新版本加载 settings
- **Then**: 自动转为 `ModelChain { primary_id: "abc", fallback_id: null, strategy: serial }`，行为不变

### 9. asr_single_online_model (Edge case)

- **Given**: 用户只配置了 1 个在线 ASR 模型
- **When**: 查看 Footer ASR 区域
- **Then**: `+ 备用` 虚线框不显示

### 10. metrics_logging (Happy path)

- **Given**: Fallback 被触发
- **When**: 备选模型完成执行
- **Then**: `llm_call_log` 中记录实际使用的模型 ID，并标注为 fallback 调用

## 实施偏差

> 功能完成后填写。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |
