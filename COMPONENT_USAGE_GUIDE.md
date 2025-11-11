# Component Usage Guide

This guide provides quick reference for using the new Headless UI components in the Handy application.

## Table of Contents

- [Menu Component](#menu-component)
- [Switch Component](#switch-component)
- [Disclosure Component](#disclosure-component)
- [Listbox Component](#listbox-component)
- [Tabs Component](#tabs-component)
- [Popover Component](#popover-component)
- [SearchInput Component](#searchinput-component)
- [Design Tokens](#design-tokens)

## Menu Component

**File**: `src/components/ui/Menu.tsx`

A dropdown menu component with keyboard navigation and icon support.

### Basic Usage

```tsx
import { Menu, MenuOption } from "@/components/ui";

const options: MenuOption[] = [
  { value: "option1", label: "Option 1" },
  { value: "option2", label: "Option 2", disabled: true },
];

<Menu
  options={options}
  selectedValue={selectedValue}
  onSelect={(value) => setSelectedValue(value)}
  placeholder="Select..."
/>;
```

### With Icons

```tsx
import { Menu, MenuOption } from "@/components/ui";
import { Settings, Trash2 } from "lucide-react";

const options: MenuOption[] = [
  { value: "settings", label: "Settings", icon: Settings },
  { value: "delete", label: "Delete", icon: Trash2 },
];
```

## Switch Component

**File**: `src/components/ui/Switch.tsx`

A toggle switch component with smooth animations.

### Basic Usage

```tsx
import { Switch } from "@/components/ui";

<Switch checked={isEnabled} onChange={(checked) => setIsEnabled(checked)} />;
```

### With Label

```tsx
<Switch
  checked={isEnabled}
  onChange={(checked) => setIsEnabled(checked)}
  label="Enable feature"
/>
```

## Disclosure Component

**File**: `src/components/ui/Disclosure.tsx`

A collapsible section component.

### Basic Usage

```tsx
import { Disclosure } from "@/components/ui";
import { Settings } from "lucide-react";

<Disclosure
  title="Advanced Settings"
  description="Configure advanced options"
  icon={Settings}
>
  {/* Content */}
</Disclosure>;
```

### With Badge

```tsx
<Disclosure title="Notifications" badge={<Badge>3 new</Badge>}>
  {/* Content */}
</Disclosure>
```

## Listbox Component

**File**: `src/components/ui/Listbox.tsx`

A select dropdown with check marks for selected items.

### Basic Usage

```tsx
import { Listbox, ListboxOption } from "@/components/ui";

const options: ListboxOption[] = [
  { value: "item1", label: "Item 1" },
  { value: "item2", label: "Item 2" },
];

<Listbox
  value={selected}
  onChange={(value) => setSelected(value)}
  options={options}
  label="Select an item"
/>;
```

## Tabs Component

**File**: `src/components/ui/Tabs.tsx`

A tab navigation component.

### Basic Usage

```tsx
import { Tabs, TabConfig } from "@/components/ui";
import { Home, Settings } from "lucide-react";

const tabs: TabConfig[] = [
  {
    id: "home",
    label: "Home",
    icon: Home,
    content: <HomePage />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    content: <SettingsPage />,
  },
];

<Tabs tabs={tabs} onTabChange={(tabId) => setActiveTab(tabId)} />;
```

### Vertical Tabs

```tsx
<Tabs tabs={tabs} vertical={true} />
```

## Popover Component

**File**: `src/components/ui/Popover.tsx`

A popover/tooltip component.

### Basic Usage

```tsx
import { Popover } from "@/components/ui";
import { Info } from "lucide-react";

<Popover trigger={<Info className="w-4 h-4" />}>
  This is a helpful tooltip
</Popover>;
```

## SearchInput Component

**File**: `src/components/ui/SearchInput.tsx`

A search field with clear button.

### Basic Usage

```tsx
import { SearchInput } from "@/components/ui";

<SearchInput
  value={searchQuery}
  onChange={(value) => setSearchQuery(value)}
  placeholder="Search..."
/>;
```

### With Clear Handler

```tsx
<SearchInput
  value={searchQuery}
  onChange={(value) => setSearchQuery(value)}
  onClear={() => console.log("Cleared")}
/>
```

## Enhanced Components

### Badge Component

```tsx
import Badge from "@/components/ui/Badge";

// Primary variant
<Badge variant="primary">Primary</Badge>

// Success variant
<Badge variant="success">Success</Badge>

// Error variant
<Badge variant="error">Error</Badge>

// With size
<Badge size="md">Medium Badge</Badge>
```

### Button Component

```tsx
import { Button } from "@/components/ui";
import { Download } from "lucide-react";

// With icon
<Button icon={Download}>Download</Button>

// Loading state
<Button loading>Processing...</Button>

// Different variants
<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="danger">Danger</Button>
<Button variant="success">Success</Button>
<Button variant="ghost">Ghost</Button>
```

### SettingsGroup Component

```tsx
import { SettingsGroup } from "@/components/ui";

// Regular
<SettingsGroup title="General" description="General settings">
  {/* Settings items */}
</SettingsGroup>

// Collapsible
<SettingsGroup
  title="Advanced"
  collapsible
  defaultOpen={false}
>
  {/* Settings items */}
</SettingsGroup>
```

## Design Tokens

### Using Color Tokens

```tsx
import { colors } from "@/design-system/tokens";

// In component:
<div style={{ color: colors.text }}>Text</div>;
```

### Using Spacing Tokens

```tsx
import { spacing } from "@/design-system/tokens";

// In CSS or Tailwind
<div className="gap-[1rem]">{/* spacing.md = 1rem */}</div>;
```

### Available Colors

- `text`, `background`, `logo-primary`, `logo-stroke`, `text-stroke`
- `border`, `border-hover`
- `bg-subtle`, `bg-hover`, `bg-active`
- `bg-success`, `bg-error`, `bg-warning`
- `text-muted`, `text-subtle`, `text-disabled`
- `success`, `error`, `warning`, `info`

### Available Spacing

- `xs` (4px), `sm` (8px), `md` (16px), `lg` (24px), `xl` (32px)
- `2xl` (40px), `3xl` (48px)

## Accessibility Features

All components include:

- Full keyboard navigation
- ARIA labels and descriptions
- Proper focus management
- Screen reader support
- High contrast focus rings
- Semantic HTML structure

## Style Guide

### Colors

```tsx
// Primary action
bg-logo-primary

// Hover state
hover:bg-logo-primary/90
hover:bg-mid-gray/10

// Disabled state
disabled:opacity-50

// Borders
border border-mid-gray/20
```

### Focus Ring

```tsx
focus:outline-none
focus-visible:ring-2
focus-visible:ring-logo-primary
focus-visible:ring-offset-2
```

### Transitions

```tsx
transition-all duration-150
transition-colors duration-200
```

## Best Practices

1. **Always use design tokens** for colors and spacing
2. **Add ARIA labels** to interactive components
3. **Test keyboard navigation** with Tab and arrow keys
4. **Provide visual feedback** for all user interactions
5. **Use semantic HTML** (button, input, label tags)
6. **Ensure proper contrast** ratios for text
7. **Test with screen readers** for accessibility

## Migration from Old Components

### Dropdown → Menu

```tsx
// Old
<Dropdown options={options} selectedValue={value} onSelect={onChange} />

// New
<Menu options={options} selectedValue={value} onSelect={onChange} />
```

### Old Toggle Input → Switch

```tsx
// Old
<input type="checkbox" checked={value} onChange={onChange} />

// New
<Switch checked={value} onChange={onChange} />
```

## Troubleshooting

### Menu/Popover not closing

- Ensure `ref={dropdownRef}` is properly attached
- Check z-index conflicts with other elements

### Focus ring not visible

- Verify `focus-visible` is supported (modern browsers)
- Check `outline: none` isn't globally applied

### Animation not smooth

- Use `transform` and `opacity` instead of `top/left`
- Enable GPU acceleration with `will-change` if needed

## Related Files

- Design System: `src/design-system/`
- Component Index: `src/components/ui/index.ts`
- Settings Search: `src/components/SettingsSearch.tsx`
- App Layout: `src/App.tsx`
