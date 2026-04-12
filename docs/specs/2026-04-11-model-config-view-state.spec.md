---
name: "模型配置页视图状态缓存"
tags: [settings, post-processing, models, ui-state]
depends_on: [post-processing-settings]
estimate: "0.5d"
---

## 意图

“让模型配置页在再次进入时保持用户上一次的浏览与筛选习惯，同时继续始终展示模型列表，减少重复操作与定位成本。”

当前模型配置页中的 provider 过滤、分组、排序、类型筛选、搜索词都保存在前端局部状态中。用户离开页面再回来后，需要重新恢复自己的浏览上下文，造成交互中断。本次改动的目标是将这些纯 UI 视图状态缓存到前端 `localStorage`，并在页面进入时恢复，形成稳定、低成本的连续体验。

## 约束

- 该需求只处理模型配置页的视图状态缓存，不修改模型业务配置语义。
- 缓存介质限定为前端 `localStorage`，不新增 Rust `AppSettings` 字段，不新增 Tauri 设置命令。
- 页面首次进入时必须直接展示模型列表，不能因缺少缓存而退回额外的初始步骤。
- 缓存恢复时必须做合法性修正：若缓存中的 provider 已不存在，则自动回退到 `all`。
- 搜索词 `query` 也参与恢复；当搜索导致空结果时，页面空态文案必须足够明确，避免用户误解为模型丢失。
- 需要遵循现有 React + Zustand + Tauri 前后端边界，不引入新的全局状态库。

## 已定决策

- 将模型列表视图状态完整缓存到 `localStorage`。
  - 缓存字段包括 `providerFilter`、`grouped`、`sortKey`、`typeFilter`、`query`。
  - 原因：这些字段都属于页面视图偏好，和业务设置无关，放在本地缓存最合适。

- 采用“每次操作后立即写入缓存”的策略，而不是仅在页面卸载时写入。
  - 原因：页面切换、热更新、意外退出时更稳，不依赖卸载时机。

- 页面初始化时优先恢复缓存；若没有缓存，则使用当前页面默认值。
  - 默认值为：`providerFilter = 当前侧栏 provider 或 all`、`grouped = true`、`sortKey = name`、`typeFilter = all`、`query = ""`。
  - 原因：兼顾首次进入的直观体验和后续进入的操作连续性。

- “是否分组”控件继续保留为 `icon + tooltip`，不增加常驻文案。
  - 原因：该控件属于次级视图控制，常驻文案会挤压工具栏空间并降低扫描效率。

- Tooltip 文案使用更直白的中文表达，例如“按提供商分组”。
  - 原因：相比抽象的“是否分组”，该文案更接近用户实际理解的操作结果。

## 边界

### 允许修改

- `src/components/settings/post-processing/ModelsConfiguration.tsx`
- `src/components/settings/post-processing/ModelConfigurationPanel.tsx`
- `src/lib/*` 下与本地缓存辅助方法直接相关的新增或小范围复用文件（如确有必要）
- 与该页面文案直接相关的 i18n 文本文件（如确有必要）

### 禁止

- `src-tauri/src/settings.rs` 及其他 Rust 设置结构
- 新增 Tauri command、invoke 绑定或数据库字段
- 修改模型业务选择、模型增删改、推理测试逻辑
- 对其他设置页的筛选/缓存行为做顺手统一改造

## 排除范围

- 不做跨设备同步的视图状态恢复。
- 不新增“重置筛选条件”之外的额外高级筛选功能。
- 不调整模型卡片布局、分组样式、排序逻辑本身。
- 不处理 API 配置区或新增模型对话框中的搜索/筛选缓存。

## 验收场景

### 1. restore_last_view_state_happy_path

- **Given**: 用户在模型配置页依次设置了 provider 过滤、关闭分组、切换排序、输入搜索词
- **When**: 用户离开设置页后再次进入模型配置页
- **Then**: 页面直接显示模型列表，且所有上述视图状态按上次操作恢复

### 2. first_visit_without_cache_happy_path

- **Given**: 当前环境中不存在该页面的本地缓存
- **When**: 用户首次进入模型配置页
- **Then**: 页面直接展示模型列表，并使用默认视图状态初始化，不出现空白态或额外中间步骤

### 3. stale_provider_cache_error_path

- **Given**: 本地缓存中的 `providerFilter` 对应的 provider 已被删除或不再存在
- **When**: 用户重新进入模型配置页
- **Then**: 页面自动回退到 `all` 视图，不报错，不出现异常空列表

### 4. cached_query_no_match_edge_case

- **Given**: 本地缓存中存在一个搜索词，当前模型列表已无法匹配该词
- **When**: 用户进入模型配置页
- **Then**: 页面仍恢复该搜索词，并展示明确的“无匹配结果”空态提示，而不是看起来像加载失败

### 5. group_toggle_affordance_edge_case

- **Given**: 用户当前处于全部 provider 视图
- **When**: 用户查看分组切换按钮
- **Then**: 按钮以 icon 展示，并通过 tooltip 明确表达“按提供商分组”的语义，且选中态可辨识

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划                        | 实际实现                                                                   | 原因                             |
| ----------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| localStorage 缓存全部视图状态 | 已按计划缓存 `providerFilter`、`grouped`、`sortKey`、`typeFilter`、`query` | 无偏差                           |
| 分组控件保留 icon + tooltip   | 维持现有控件形式，沿用已有“按服务商分组 / Group by provider”文案           | 现有文案已满足需求，无需新增 key |
