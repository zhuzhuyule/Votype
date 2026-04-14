# Compact Provider Tabs Rail

## Intent

将模型配置页中的 provider 横向切换区从“按钮感较强的 tabs”收紧为更轻量的单行 rail，减少纵向占用，并保持现有 `更多` 折叠逻辑不变。

## Decisions

- 保持现有交互逻辑：
  - 横向排列 provider
  - 放不下的项进入 `更多`
  - 从 `更多` 选择后进入主行末尾
- 仅调整视觉表达：
  - tabs 高度压缩到紧凑单行
  - provider 头像缩小
  - 未选中态弱化为轻背景/透明
  - 选中态保留轻底色与细描边
  - `更多` 采用与 tabs 同级的轻量样式
- 不在本次改动中引入新的信息栏或额外摘要

## Boundaries

允许修改：

- `src/components/settings/post-processing/ApiSettings.tsx`

禁止修改：

- provider tabs 布局算法
- provider 选择交互逻辑
- 其他设置面板结构

## Acceptance

- provider 切换区明显更紧凑，视觉上更接近轻量 tabs 而不是按钮组
- 切换区仍保持单行展示
- `更多` 的样式与普通 tab 风格一致
- 不改变已有可见/折叠逻辑
