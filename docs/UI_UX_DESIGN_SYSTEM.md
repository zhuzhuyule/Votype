# 🎨 Handy UI/UX 设计系统文档

## 📋 目录

1. [主题系统](#主题系统)
2. [Token 体系](#token-体系)
3. [核心组件](#核心组件)
4. [页面布局](#页面布局)
5. [交互与动效](#交互与动效)
6. [实施指南](#实施指南)

---

## 🌗 主题系统

### 两种颜色模式

- **Light Mode**: 亮色背景，深色文本
- **Dark Mode**: 深色背景，亮色文本

### 五个预制主题

| 主题名           | Accent  | 特性           | 最佳场景         |
| ---------------- | ------- | -------------- | ---------------- |
| **Pro Dark**     | #60A5FA | 冰蓝、高科技感 | 专业办公、开发者 |
| **Neon Pulse**   | #5EEAD4 | 青绿、活跃动感 | 创意工作、设计师 |
| **Solar Light**  | #FACC15 | 金黄、温暖精致 | 创作环境、舒适感 |
| **Mono Minimal** | #9CA3AF | 中性灰、极简   | 最小化干扰、专注 |
| **Calm Blue**    | #93C5FD | 柔蓝、平静     | 冥想、放松工作   |

### 主题切换方式

```typescript
// 使用 themeStore
import { useThemeStore } from "@/stores/themeStore";

const { mode, theme, setMode, setTheme } = useThemeStore();

// 切换模式
setMode("dark"); // 或 "light" 或 "system"

// 切换主题
setTheme("neon-pulse");
```

---

## 🎨 Token 体系

### 语义色彩 (Light Mode)

```css
--color-text: #0f0f0f; /* 主文本 */
--color-text-secondary: #666666; /* 次级文本 */
--color-text-tertiary: #999999; /* 辅助文本 */
--color-background: #f8f8f8; /* 页面背景 */
--color-surface: #ffffff; /* 卡片/表面 */
--color-card: #fafafa; /* 分组背景 */
--color-border: rgba(0, 0, 0, 0.08); /* 边框 */
--color-border-strong: rgba(0, 0, 0, 0.16); /* 强边框 */
```

### 语义色彩 (Dark Mode)

```css
--color-text: #ffffff;
--color-text-secondary: #aaaaaa;
--color-text-tertiary: #808080;
--color-background: #1a1a1a;
--color-surface: #252525;
--color-card: #2d2d2d;
--color-border: rgba(255, 255, 255, 0.12);
--color-border-strong: rgba(255, 255, 255, 0.24);
```

### 间距系统

```
xs: 4px    sm: 8px    md: 12px    lg: 16px
xl: 24px   2xl: 32px  3xl: 48px   4xl: 64px
```

### 圆角系统

```
xs: 4px    sm: 6px    md: 8px    lg: 12px
```

### 阴影系统

```
shadow-xs: 0 1px 2px rgba(0,0,0,0.04)
shadow-sm: 0 2px 4px rgba(0,0,0,0.06), 0 1px 1px rgba(0,0,0,0.04)
shadow-md: 0 4px 8px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)
shadow-lg: 0 10px 20px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)
shadow-xl: 0 20px 40px rgba(0,0,0,0.16), 0 8px 16px rgba(0,0,0,0.12)
```

---

## 🧩 核心组件

### Button

**变体**: primary, secondary, danger, ghost  
**尺寸**: sm, md, lg  
**状态**: default, hover, active, focus, disabled, loading

```tsx
<Button variant="primary" size="md">
  Save Changes
</Button>
```

**样式规范**:

- Hover: 背景提亮 +10%, Y 轴 -1px
- Active: 背景加深 -10%, Y 轴 +1px
- Focus: ring-2 accent色环，2px offset
- 过渡: 200ms cubic-bezier(0.4, 0, 0.2, 1)

### Input

**属性**: text, email, password, number  
**变体**: default, compact  
**状态**: default, hover, focus, error, disabled

```tsx
<Input type="email" placeholder="you@example.com" variant="default" />
```

**交互**:

- Focus: border 变 accent 色，加上 ring-2
- 过渡: 200ms

### Card

**elevation**: 0 (无阴影), 1 (轻), 2 (中)  
**padding**: sm, md, lg  
**interactive**: 可选 hover 提升效果

```tsx
<Card elevation={1} padding="lg" interactive>
  Card content
</Card>
```

### Modal

**大小**: sm, md, lg, xl  
**特性**: Backdrop 半透明, ESC 关闭, 自动焦点管理

```tsx
<Modal
  isOpen={isOpen}
  onClose={handleClose}
  title="Confirm Action"
  actions={
    <>
      <Button variant="ghost">Cancel</Button>
      <Button variant="primary">Confirm</Button>
    </>
  }
>
  Modal content
</Modal>
```

### FormRow

用于表单字段，包含 Label、Helper Text、Error、Tooltip

```tsx
<FormRow
  label="Email"
  required
  error={errors.email}
  helper="We'll never share your email"
  tooltip="Your unique email address"
>
  <Input type="email" />
</FormRow>
```

### Toast

通知消息，支持 success, error, info, warning

```tsx
import { showToast } from "@/components/ui";

showToast("Settings saved!", "success");
showToast("Something went wrong", "error", 5000);
```

---

## 📐 页面布局

### 全局框架

```
┌─────────────────────────────────────┐
│ Sidebar (56px) | Main Content       │
├─────────────────────────────────────┤
│ 导航          | 各页面内容          │
│               | 可选侧栏面板        │
└─────────────────────────────────────┘
```

### 主要页面

#### Home - 录音控制中心

- 大型录音按钮 (Primary)
- 设备状态卡片
- 快捷键提示
- 今日统计

#### Models - 三栏布局

- 左: Provider 列表
- 中: 缓存模型
- 右: 详情编辑

#### Appearance - 主题管理

- 颜色模式选择 (Light/Dark/System)
- 5 个主题预设卡片
- 实时预览

#### Settings

标签导航结构:

- General
- Appearance
- Audio
- Shortcuts
- Advanced
- About

---

## ⚡ 交互与动效

### 按钮交互

```
Hover:   Y -1px, 背景 +10%, 过渡 200ms
Active:  Y +1px, 背景 -10%
Focus:   ring-2 accent/40, offset 0
Loading: spinner rotate 1.2s
```

### Input 焦点

```
边框:    mid-gray/15 → accent
Ring:    2px accent/20
过渡:    100ms ease-out
```

### Modal 动效

```
进入:    Backdrop fade-in 200ms, Modal zoom-in-95 200ms
退出:    反向 200ms
缓动:    ease-out
```

### Toast 动效

```
进入:    slide-in-from-right 200ms
消失:    2.5s 后自动 slide-out 200ms
堆叠:    自动纵向排列
```

### 页面过渡

```
过渡:    fade-in 150ms (可选)
保持:    不打断用户操作
```

---

## 🛠️ 实施指南

### 1. 初始化主题

```tsx
// App.tsx 中自动初始化
import { useThemeStore } from "@/stores/themeStore";

function App() {
  useThemeStore(); // 主题自动应用
  return (...)
}
```

### 2. 使用新 Token

```tsx
// 优先使用语义 Token
className = "bg-surface border border-border text-text";

// 而不是硬编码颜色
className = "bg-white border border-gray-200 text-black";
```

### 3. 组件使用示例

```tsx
import { Button, Input, Card, Modal, FormRow } from "@/components/ui";

export const ExamplePage = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card elevation={1} padding="lg">
      <FormRow label="Name" required>
        <Input placeholder="Enter your name" />
      </FormRow>

      <Button onClick={() => setIsOpen(true)} className="mt-lg">
        Open Dialog
      </Button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Confirm">
        <p>Are you sure?</p>
      </Modal>
    </Card>
  );
};
```

### 4. 主题切换实现

```tsx
// 在 Appearance 设置中
import { useThemeStore } from "@/stores/themeStore";

export const ThemeSelector = () => {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="space-y-md">
      {themes.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          className={theme === t.id ? "ring-2 ring-accent" : ""}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
};
```

---

## 📚 已实现的组件

✅ Button  
✅ Input  
✅ Select  
✅ Dropdown  
✅ Textarea  
✅ Slider  
✅ ToggleSwitch  
✅ Badge  
✅ Card  
✅ Modal  
✅ FormRow  
✅ Toast  
✅ ResetButton  
✅ SettingContainer  
✅ SettingsGroup  
✅ TextDisplay

---

## 🎯 下一步

- [ ] 完整页面布局重设计
- [ ] 录音面板现代化
- [ ] History 页面三栏布局
- [ ] Prompts 管理界面
- [ ] 响应式设计适配
- [ ] 可访问性审计 (WCAG AA)
- [ ] 性能优化

---

## 📞 支持

有问题或建议？查看 README.md 或提交 Issue。
