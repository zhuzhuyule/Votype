# UI Components

这个目录包含了项目中使用的可复用 UI 组件。

## 组件列表

### TooltipIcon
一个封装了 help icon 和 tooltip 的独立组件。

```tsx
import { TooltipIcon } from './ui';

<TooltipIcon 
  text="标题"
  description="详细描述信息"
  tooltipPosition="top" // 可选，默认 "top"
  className="" // 可选，自定义样式类
/>
```

**特点：**
- 包含 help 图标 (?图标)
- 自动显示 tooltip 内容
- 支持位置配置 (top/bottom)
- 已优化性能，使用 `React.memo`
- 统一的样式和交互效果

### SettingContainer
用于包装设置项的容器组件。

```tsx
import { SettingContainer } from './ui';

<SettingContainer
  title="设置项标题"
  description="详细描述"
  descriptionMode="tooltip" // "tooltip" | "inline"
  layout="horizontal" // "horizontal" | "stacked"
  disabled={false}
  tooltipPosition="top"
>
  {/* 设置项内容 */}
  <YourComponent />
</SettingContainer>
```