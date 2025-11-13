# UI组件重构规则 - 从原生HTML标签到Radix UI组件

## 概述
本文档记录了将UI目录下的组件从原生HTML标签重构为Radix UI主题组件的规则和最佳实践。

## 基本原则
1. 保持现有功能和样式不变
2. 利用Radix UI的主题系统和可访问性特性
3. 遵循Radix UI组件的设计模式
4. 保持组件API的向后兼容性

## HTML标签到Radix UI组件的映射规则

### 布局容器
- `div` (布局容器) → `Box` 或 `Flex`
  - 如果需要flex布局 → `Flex`
  - 如果是普通容器 → `Box`
- `div` (纯文本内容) → `Text` 或 `Heading`
  - 如果是标题文本 → `Heading`
  - 如果是普通文本 → `Text`

### 文本内容
- `h1`-`h6` → `Heading` (设置相应的size属性)
- `p` → `Text`
- `span` → `Text`
- `label` → `Text` (配合 htmlFor 属性)

### 交互元素
- `button` → `Button` 或 `IconButton`
  - 如果有图标 → `IconButton`
  - 如果有文本 → `Button`
- `input` → `TextField.Input`
- `textarea` → `TextArea`
- `select` → `Select` (Radix UI Select组件)

### 特殊元素
- `audio` → 保持原生标签 (Radix UI没有音频组件)
- `svg` (图标) → 保持Lucide图标或使用Radix UI图标

## div标签转换决策树

```
div元素
├── 是否用于布局？
│   ├── 是 → 检查是否需要flex布局
│   │   ├── 是 → 使用 Flex
│   │   └── 否 → 使用 Box
│   └── 否 → 检查是否包含纯文本
│       ├── 是 → 检查是否为标题
│       │   ├── 是 → 使用 Heading
│       │   └── 否 → 使用 Text
│       └── 否 → 使用 Box (复杂内容容器)
```

## Context7查询结果更新

### Box vs Text/Heading 使用场景
- **Box**: 用于布局容器，支持所有布局属性(width, height, padding, margin等)
- **Text**: 用于文本内容，可以使用`as`属性渲染为不同HTML元素(p, label, span, div)
- **Heading**: 用于标题文本，语义化标题元素

### TextField结构更新
Radix UI Themes更新了TextField结构：
- 移除了TextField.Input，直接使用TextField.Root
- TextField.Slot需要明确指定side属性(left/right)

### 布局组件尺寸更新
width和height属性现在使用像素值：
- 旧: `<Box width="1" height="2" />`
- 新: `<Box width="4px" height="8px" />`

## 组件重构顺序
按照依赖关系，从基础组件开始：

1. **Button.tsx** - 最基础组件
2. **Input.tsx** 和 **Textarea.tsx** - 表单组件
3. **Badge.tsx** - 显示组件
4. **SettingsGroup.tsx** - 容器组件
5. **TooltipIcon.tsx** - 交互组件
6. **TextDisplay.tsx** - 复合组件
7. **Dropdown.tsx** - 选择组件
8. **AudioPlayer.tsx** - 媒体组件

## 重构注意事项

### 保持样式一致性
- 保留原有的className逻辑
- 将Tailwind类与Radix UI的样式系统结合
- 确保主题颜色和交互状态一致

### 保持功能完整性
- 所有事件处理器必须保留
- 组件API保持不变
- 特殊功能（如字符计数、验证等）必须保留

### 可访问性
- 利用Radix UI的内置可访问性特性
- 保留所有aria属性
- 确保键盘导航正常工作

## 组件特定规则

### Button组件
- 使用Radix UI的Button组件
- 保持variant和size属性
- 保留loading状态和disabled状态

### Input/Textarea组件
- 使用TextField.Root和TextField.Input/TextArea
- 保留Label、错误处理和描述文本
- 保持验证逻辑

### Badge组件
- 使用Flex和Text组件
- 保留variant样式
- 移除按钮使用IconButton

### SettingsGroup组件
- 使用Flex、Heading、Text组件
- 保留折叠功能
- 保持布局结构

## 验证清单
每个组件重构后需要验证：
- [ ] 功能是否正常工作
- [ ] 样式是否与原组件一致
- [ ] 主题切换是否正常
- [ ] 可访问性是否保持
- [ ] 组件API是否向后兼容
- [ ] 是否有控制台错误

## 更新日志
每个组件重构后在此记录：
- [x] Button.tsx - 已重构
  - 使用Radix UI的Button组件替换原生button
  - 保持了variant和size属性映射
  - 保留了loading状态功能
- [x] Input.tsx - 已重构
  - 使用TextField.Root和TextField.Slot替换原生input
  - 保持了Label、错误处理和描述文本功能
  - 正确处理了leftIcon使用TextField.Slot
- [x] Textarea.tsx - 已重构
  - 使用Radix UI的TextArea组件
  - 保持了字符计数和验证逻辑
  - 正确处理了minHeight和size属性
- [x] Badge.tsx - 已重构
  - 使用Flex和Text组件替换原生span
  - 使用IconButton替换原生button
  - 保留了variant样式和onRemove功能
- [x] SettingsGroup.tsx - 已重构
  - 使用Flex、Heading、Text替换原生div、h2、p
  - 使用Radix UI的ChevronDownIcon替换原生svg
  - 保持了折叠功能和布局结构
- [x] TooltipIcon.tsx - 已重构
  - 使用IconButton替换原生button
  - 使用Box和Text替换原生div和p
  - 使用Radix UI的HelpCircleIcon替换Lucide图标
- [x] TextDisplay.tsx - 已重构
  - 使用Flex和Text替换原生div和span
  - 使用IconButton替换原生button
  - 使用Radix UI的CopyIcon和CheckIcon替换原生svg
- [x] Dropdown.tsx - 已重构
  - 使用Button替换原生button
  - 使用Flex、Text、Box替换原生div和span
  - 使用Radix UI的ChevronDownIcon替换原生svg
- [x] AudioPlayer.tsx - 已重构
  - 使用IconButton替换原生button
  - 使用Flex、Text、Box替换原生div和span
  - 使用Radix UI的PlayIcon和PauseIcon替换Lucide图标
  - 保持了audio标签（Radix UI没有音频组件）

## 重构总结
所有UI组件已成功重构为使用Radix UI主题组件，移除了原生HTML标签的使用。重构过程中：
1. 保持了所有现有功能和样式
2. 利用了Radix UI的主题系统和可访问性特性
3. 遵循了Radix UI组件的设计模式
4. 保持了组件API的向后兼容性
5. 正确处理了div标签的转换（根据内容类型选择Box/Flex/Text/Heading）