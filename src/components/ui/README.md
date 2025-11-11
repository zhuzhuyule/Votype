# Enhanced UI Components with HeadlessUI

This directory contains a comprehensive set of UI components built with HeadlessUI and Tailwind CSS, featuring smooth micro-interactions and accessibility-first design.

## 🎨 Component Overview

### Input Components

#### Input
Enhanced text input with labels, descriptions, error states, and icon support.

```tsx
import { Input } from './components/ui';

// Basic usage
<Input
  placeholder="Enter text..."
  value={value}
  onChange={(e) => setValue(e.target.value)}
/>

// With label and description
<Input
  label="Email Address"
  description="We'll never share your email"
  placeholder="your@email.com"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>

// With icons
<Input
  leftIcon={<Search size={16} />}
  placeholder="Search..."
/>

// With error state
<Input
  label="Password"
  error="Password must be at least 8 characters"
  type="password"
/>
```

**Features:**
- Focus ring animations
- Icon support (left/right)
- Label and description
- Error state handling
- Disabled state
- Variants: default, compact

#### Textarea
Multi-line text input with character counting.

```tsx
<Textarea
  label="Description"
  placeholder="Enter description..."
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  showCharCount
  maxLength={200}
/>
```

**Features:**
- Character counter with warning at 90%
- Auto-resize
- Same states as Input

### Selection Components

#### Select (HeadlessUI Listbox)
Dropdown select with smooth animations.

```tsx
import { Select } from './components/ui';

const options = [
  { value: 'opt1', label: 'Option 1' },
  { value: 'opt2', label: 'Option 2', isDisabled: true },
];

<Select
  value={selected}
  options={options}
  onChange={setSelected}
  placeholder="Choose an option..."
  isClearable
/>
```

**Features:**
- Smooth scale/opacity transitions
- Clearable option
- Loading state
- Keyboard navigation
- Check icon for selected items

#### Dropdown (HeadlessUI Menu)
Menu-style dropdown component.

```tsx
<Dropdown
  selectedValue={value}
  options={options}
  onSelect={setValue}
  placeholder="Select..."
  onRefresh={() => fetchOptions()}
/>
```

#### Combobox
Searchable select component.

```tsx
<Combobox
  label="Search Items"
  value={selected}
  options={options}
  onChange={setSelected}
  placeholder="Search..."
/>
```

**Features:**
- Real-time filtering
- Keyboard navigation
- Same styling as Select

### Action Components

#### Button
Enhanced button with loading states and animations.

```tsx
<Button
  variant="primary" // primary | secondary | danger | ghost
  size="md" // sm | md | lg
  isLoading={loading}
  onClick={handleClick}
>
  Click Me
</Button>
```

**Features:**
- Active scale animation (95%)
- Loading state with spinner
- Focus rings with offset
- Hover shadows
- 4 variants, 3 sizes

#### Badge
Tag/chip component with optional remove button.

```tsx
<Badge
  variant="success" // primary | secondary | success | warning | error | info
  size="md" // sm | md | lg
  onRemove={() => handleRemove()}
>
  Tag Name
</Badge>
```

**Features:**
- 6 color variants
- 3 sizes
- Optional remove button
- Smooth transitions

### Control Components

#### ToggleSwitch (HeadlessUI Switch)
Accessible toggle switch.

```tsx
<ToggleSwitch
  checked={enabled}
  onChange={setEnabled}
  label="Enable Feature"
  description="This enables the feature"
/>
```

**Features:**
- Smooth toggle animation
- Scale animation on hover
- Focus ring
- Integrates with SettingContainer

#### Slider
Range input with visual feedback.

```tsx
<Slider
  value={volume}
  onChange={setVolume}
  min={0}
  max={1}
  step={0.01}
  label="Volume"
  description="Adjust the volume"
  showValue
  formatValue={(v) => `${Math.round(v * 100)}%`}
/>
```

**Features:**
- Dragging indicator appears on focus/drag
- Value highlights when active
- Smooth height transition on hover
- Focus ring

### Layout Components

#### Dialog
Modal/dialog component with backdrop.

```tsx
<Dialog
  isOpen={open}
  onClose={() => setOpen(false)}
  title="Confirm Action"
  size="md" // sm | md | lg | xl
  showCloseButton
>
  <p>Dialog content here</p>
  <div className="flex gap-2 justify-end">
    <Button onClick={() => setOpen(false)}>Cancel</Button>
    <Button variant="primary">Confirm</Button>
  </div>
</Dialog>
```

**Features:**
- Backdrop blur
- Smooth scale/fade animations
- Click outside to close
- ESC to close
- Focus trap

#### Tooltip
Hover tooltip using Popover.

```tsx
<Tooltip
  content="This is helpful information"
  position="top" // top | bottom | left | right
>
  <span>Hover me</span>
</Tooltip>
```

**Features:**
- 500ms delay before showing
- 4 positions
- Smooth fade animation

## 🎯 Design System

### Transitions
All components use consistent transition timing:
- **Duration:** 200ms
- **Easing:** ease-in-out
- **Properties:** all, colors, transform, opacity

### Focus States
- 2px solid ring in primary color
- 2px offset from element
- Ring offset matches background

### Colors
Components use CSS custom properties:
- `--color-logo-primary`: Primary actions
- `--color-mid-gray`: Neutral elements
- `--color-background`: Base background
- `--color-text`: Text color

### Hover States
- Background: 10% primary color mix
- Border: Primary color
- Subtle shadows on buttons

### Active States
- Scale: 95% (0.95 transform)
- Provides tactile feedback

## 🚀 Micro-Interactions

1. **Input Focus:** Smooth border color change + ring appearance + background tint
2. **Button Press:** Scale down animation for tactile feedback
3. **Dropdown Open:** Scale from 95% to 100% + fade in
4. **Toggle Switch:** Smooth position transition + hover scale on knob
5. **Slider Drag:** Indicator appears + value highlights
6. **Badge Remove:** Hover state on remove button
7. **Loading States:** Spinner animations

## ♿ Accessibility

All components follow ARIA best practices:
- Proper ARIA labels and roles
- Keyboard navigation support
- Focus management
- Screen reader friendly
- Color contrast compliance
- Disabled state handling

## 📦 Export

All components are exported from `./components/ui/index.ts`:

```tsx
import {
  Input,
  Textarea,
  Select,
  Dropdown,
  Combobox,
  Button,
  Badge,
  ToggleSwitch,
  Slider,
  Dialog,
  Tooltip,
  // ... others
} from './components/ui';
```

## 🎪 Showcase

See `ComponentShowcase.tsx` for live examples of all components with various states and configurations.

## 🔧 Customization

All components accept a `className` prop for custom styling. They use Tailwind CSS utility classes and can be easily customized through Tailwind's configuration.

## 📚 Dependencies

- **@headlessui/react**: Unstyled, accessible UI components
- **lucide-react**: Icon library
- **tailwindcss**: Utility-first CSS framework

## 🤝 Contributing

When adding new components:
1. Use HeadlessUI primitives when available
2. Follow the established animation patterns (200ms, ease-in-out)
3. Implement all states (default, hover, focus, active, disabled, error)
4. Add proper TypeScript types
5. Include accessibility features
6. Update this README with usage examples
