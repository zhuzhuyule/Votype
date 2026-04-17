# Hotword Correction/Force Replace Rows Implementation Plan

## Goal

把热词的“纠错词”和“强替词”收敛到单个词条内部，形成两个同级字段：

- `originals`
- `force_replace_originals`

并在编辑面板里以上下两行方式提供添加、删除、拖拽互转。

## Implementation

### Task 1: 数据模型收敛到单词条双字段

- 在 Rust `Hotword` 和前端 `Hotword` 类型中新增 `force_replace_originals`
- 保留 `originals` 作为原有纠错词
- 迁移时兼容旧临时字段 `force_replace` / `entry_type`
- 运行时不再依赖 `entry_type`

### Task 2: 本地强替链路

- 在原始 ASR 文本出来后调用 `apply_force_replacements`
- 仅使用 `force_replace_originals -> target`
- 仅作用于 `status=active`
- 仅做精确匹配
- 不进入 LLM 注入和 correction pairs

### Task 3: 编辑面板双行交互

- 保持词汇表主结构和分类分组不变
- 在单个词条编辑面板中增加：
  - `纠错`
  - `强替`
- 两行都支持加号录入
- 两行之间支持拖拽互转

### Task 4: 验证

- Rust:
  - `managers::hotword::tests::test_apply_force_replacements_replaces_only_active_exact_matches`
  - `managers::hotword::tests::test_contextual_injection_excludes_force_replace_aliases_from_correction_pairs`
  - `managers::hotword::tests::test_contextual_injection_prefers_document_and_instruction_matches`
- Frontend:
  - `bun x tsc --noEmit`
