# UI Components

This directory contains reusable UI components for the Handy application.

## Select vs Dropdown

### Select Component
- **Based on**: `@radix-ui/react-select`
- **Use for**: Standard form selections, simple option choices
- **Features**:
  - Better accessibility for form inputs
  - Keyboard navigation support
  - Position control (`position="popper"` or `"item-aligned"`)
  - Clear functionality (`isClearable`)
  - Loading states
  - Creatable options support
  - Refresh callback support (`onRefresh`)

```typescript
import { Select, SelectOption } from "../ui/Select";

const options: SelectOption[] = [
  { value: "option1", label: "Option 1" },
  { value: "option2", label: "Option 2" },
];

<Select
  value={selectedValue}
  options={options}
  onChange={(value) => setSelectedValue(value)}
  position="popper"
  placeholder="Select an option..."
/>
```

### Dropdown Component
- **Based on**: `@radix-ui/react-dropdown-menu`
- **Use for**: Complex content, menu-like interactions, refresh functionality
- **Features**:
  - Menu-style dropdown
  - Custom content support
  - Built-in refresh functionality
  - Better for dynamic content

```typescript
import { Dropdown } from "../ui/Dropdown";

<Dropdown
  options={options}
  selectedValue={selectedValue}
  onSelect={handleSelect}
  onRefresh={refreshOptions}
/>
```

## Migration Guide

### When to use Select:
- Simple option selection
- Form inputs
- When you need better accessibility
- When you need position control with `position="popper"`

### When to keep Dropdown:
- Complex custom content (e.g., ModelDropdown with progress bars)
- Dynamic content that needs refresh functionality
- Menu-style interactions

### Recent Migrations:
- ✅ `PasteMethod` component migrated from Dropdown to Select
- ✅ Select component enhanced with `position="popper"` support
- ✅ Select component enhanced with `onRefresh` callback support