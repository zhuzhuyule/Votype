---
name: "词汇表内纠错词/强替词双行"
tags: [hotword, asr, post-processing]
depends_on: [hotwords, transcription]
estimate: "0.5-1 天"
---

## 意图

在单条词汇表记录内部，把“纠错词”和“强行替换词”建模为两个同级字段，而不是两个平行 section。用户可以在同一个词条编辑面板里，直接为目标词维护：

- `类别`
- `场景`
- `纠错词`
- `强行替换词`

其中：

- `纠错词` 参与现有 LLM 纠错参考与 correction pairs
- `强行替换词` 只在原始 ASR 文本出来后做本地精确替换，不进入 LLM

## 已定决策

- `hotwords` 保持单表，不新增独立规则表。
- `Hotword` 新增 `force_replace_originals`，与原有 `originals` 平级。
- `originals` 表示纠错词；`force_replace_originals` 表示强替词。
- 强替发生在原始 ASR 文本生成后、AI 后处理之前。
- 强替只做精确匹配，不使用模糊阈值。
- 编辑面板里“纠错 / 强替”采用上下两行展示，并支持拖拽互转。

## 约束

- 仅 `status = active` 的词条可参与本地强替。
- `force_replace_originals` 不进入 prompt 注入，也不生成 correction pairs。
- 需兼容已存在的临时字段：
  - `force_replace`
  - `entry_type`
- 历史兼容只用于迁移，不继续作为运行时语义。

## 边界

### 允许修改

- `src-tauri/src/managers/history.rs`
- `src-tauri/src/settings.rs`
- `src-tauri/src/managers/hotword.rs`
- `src-tauri/src/commands/hotword.rs`
- `src-tauri/src/managers/transcription.rs`
- `src/types/hotword.ts`
- `src/components/settings/hotword/HotwordSettings.tsx`
- `src/components/settings/hotword/HotwordTagCloud.tsx`
- `src/components/settings/hotword/HotwordEditPanel.tsx`

### 不做

- 不新增全局“强替区” section
- 不新增独立 `forced_replacements` 表
- 不做模糊强替
- 不让同一个别名同时存在于纠错词和强替词

## 验收场景

### 1. 本地强替命中

- Given: `target="差距"`，`force_replace_originals=["叉举"]`
- When: 原始 ASR 文本包含“叉举”
- Then: 在进入后续 AI 链路前替换成“差距”

### 2. 强替不进 LLM

- Given: `target="差距"`，`originals=["常规纠错"]`，`force_replace_originals=["叉举"]`
- When: 构建 contextual injection
- Then: `常规纠错 -> 差距` 可以进入 correction pairs，但 `叉举 -> 差距` 不进入

### 3. 编辑面板拖拽互转

- Given: 单个词条编辑面板已打开
- When: 用户把某个别名从“纠错”拖到“强替”
- Then: 该别名从 `originals` 移到 `force_replace_originals`

## 实施偏差

| 原计划                        | 实际实现                          | 原因                                                                   |
| ----------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| 平行“纠错区 / 强替区” section | 单个词条内的“纠错词 / 强替词”双行 | 用户进一步澄清，要求它们是词条属性级别的同级概念，而不是页面级平行容器 |
