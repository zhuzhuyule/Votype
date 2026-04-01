# Spec 编写规范

> 参考 [Vox](https://github.com/ZhangHanDong/vox) 项目的结构化 spec 格式，结合 Votype 项目实际情况制定。

## 模板

新功能 spec 文件命名：`docs/specs/{date}-{feature-name}.spec.md`（如 `2026-04-01-meeting-minutes.spec.md`）

```markdown
---
name: "功能名称"
tags: [tag1, tag2]
depends_on: [前置依赖]
estimate: "预估工时"
---

## 意图

一段话说明做什么、为什么做、解决什么问题。用引号包裹核心描述，确保意图不可被曲解。

## 约束

- 技术限制、兼容性要求、性能要求
- 与现有系统的交互边界
- 必须遵守的规则（如 CLAUDE.md 中的 runtime rules）

## 已定决策

明确列出已确认的技术方案，每项包含：

- 决策内容
- 选择原因（如有替代方案，说明为何不选）

## 边界

### 允许修改

- [具体文件路径列表]

### 禁止

- [具体禁令及原因]

## 排除范围

明确列出本次不做的事项，防止范围蔓延。

## 验收场景

每个场景覆盖三类之一：Happy path / Error path / Edge case

### 1. scenario_name

- **Given**: 前置条件
- **When**: 触发动作
- **Then**: 可观测结果

### 2. scenario_name_error

- **Given**: 前置条件
- **When**: 异常触发
- **Then**: 错误处理行为

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |
```

## 编写原则

1. **意图先行**：先写清楚为什么做，再写怎么做
2. **边界明确**：允许和禁止的文件列表，防止改动扩散
3. **验收驱动**：至少覆盖 happy path、error path、edge case 三类
4. **偏差记录**：功能交付后回填实施偏差表，保持 spec 作为活文档
5. **排除范围**：明确不做什么，比写做什么更重要
