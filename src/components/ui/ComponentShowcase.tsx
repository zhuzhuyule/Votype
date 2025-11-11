/**
 * Component Showcase - Examples of all enhanced UI components
 * This file demonstrates the HeadlessUI-powered components with micro-interactions
 *
 * Usage: Import this component in development to preview all UI components
 */

import React, { useState } from "react";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Button } from "./Button";
import { Select } from "./Select";
import { Dropdown } from "./Dropdown";
import { ToggleSwitch } from "./ToggleSwitch";
import { Slider } from "./Slider";
import { Combobox } from "./Combobox";
import { Dialog } from "./Dialog";
import Badge from "./Badge";
import { Search, Mail, Lock } from "lucide-react";

export const ComponentShowcase: React.FC = () => {
  const [inputValue, setInputValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  const [selectValue, setSelectValue] = useState<string | null>("option1");
  const [dropdownValue, setDropdownValue] = useState<string | null>("item1");
  const [comboboxValue, setComboboxValue] = useState<string | null>(null);
  const [toggleValue, setToggleValue] = useState(false);
  const [sliderValue, setSliderValue] = useState(0.5);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const selectOptions = [
    { value: "option1", label: "Option 1" },
    { value: "option2", label: "Option 2" },
    { value: "option3", label: "Option 3" },
    { value: "option4", label: "Option 4 (Disabled)", isDisabled: true },
  ];

  const dropdownOptions = [
    { value: "item1", label: "Item 1" },
    { value: "item2", label: "Item 2" },
    { value: "item3", label: "Item 3" },
  ];

  const comboboxOptions = [
    { value: "apple", label: "Apple" },
    { value: "banana", label: "Banana" },
    { value: "cherry", label: "Cherry" },
    { value: "date", label: "Date" },
    { value: "elderberry", label: "Elderberry" },
  ];

  const handleLoadingDemo = async () => {
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <h1 className="text-3xl font-bold text-text mb-8">
        Enhanced UI Components Showcase
      </h1>

      {/* Input Components */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Input Components</h2>

        <Input
          label="Basic Input"
          description="This is a basic input field with label and description"
          placeholder="Enter text..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />

        <Input
          label="Input with Icon"
          placeholder="Search..."
          leftIcon={<Search size={16} />}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Email Input"
            type="email"
            placeholder="your@email.com"
            leftIcon={<Mail size={16} />}
          />

          <Input
            label="Password Input"
            type="password"
            placeholder="Enter password"
            leftIcon={<Lock size={16} />}
          />
        </div>

        <Input
          label="Input with Error"
          placeholder="This has an error"
          error="This field is required"
        />

        <Input label="Disabled Input" placeholder="Disabled" disabled />
      </section>

      {/* Textarea */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Textarea</h2>

        <Textarea
          label="Description"
          description="Enter a detailed description"
          placeholder="Type here..."
          value={textareaValue}
          onChange={(e) => setTextareaValue(e.target.value)}
          showCharCount
          maxLength={200}
        />

        <Textarea
          label="Textarea with Error"
          placeholder="This has an error"
          error="This field is required"
        />
      </section>

      {/* Select & Dropdown */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">
          Select & Dropdown Components
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-2">
              Select (HeadlessUI Listbox)
            </label>
            <Select
              value={selectValue}
              options={selectOptions}
              onChange={setSelectValue}
              placeholder="Choose an option..."
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Dropdown (HeadlessUI Menu)
            </label>
            <Dropdown
              selectedValue={dropdownValue}
              options={dropdownOptions}
              onSelect={setDropdownValue}
              placeholder="Select an item..."
            />
          </div>
        </div>

        <div>
          <Combobox
            label="Combobox with Search"
            description="Type to filter options"
            value={comboboxValue}
            options={comboboxOptions}
            onChange={setComboboxValue}
            placeholder="Search fruits..."
          />
        </div>
      </section>

      {/* Buttons */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Buttons</h2>

        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary Button</Button>
          <Button variant="secondary">Secondary Button</Button>
          <Button variant="danger">Danger Button</Button>
          <Button variant="ghost">Ghost Button</Button>
          <Button variant="primary" disabled>
            Disabled Button
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" size="md">
            Medium
          </Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
        </div>

        <div className="flex gap-3">
          <Button
            variant="primary"
            isLoading={isLoading}
            onClick={handleLoadingDemo}
          >
            {isLoading ? "Loading..." : "Click to Load"}
          </Button>
        </div>
      </section>

      {/* Badges */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Badges</h2>

        <div className="flex flex-wrap gap-2">
          <Badge variant="primary">Primary</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="info">Info</Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge size="sm">Small</Badge>
          <Badge size="md">Medium</Badge>
          <Badge size="lg">Large</Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" onRemove={() => console.log("Remove 1")}>
            Removable 1
          </Badge>
          <Badge variant="success" onRemove={() => console.log("Remove 2")}>
            Removable 2
          </Badge>
          <Badge variant="info" onRemove={() => console.log("Remove 3")}>
            Removable 3
          </Badge>
        </div>
      </section>

      {/* Toggle Switch (requires SettingContainer wrapper - simplified example) */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Toggle Switch</h2>
        <div className="text-sm text-mid-gray/80">
          Toggle switches are typically used within SettingContainer. See
          actual settings for examples.
        </div>
      </section>

      {/* Slider */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Slider</h2>
        <div className="text-sm text-mid-gray/80">
          Sliders are typically used within SettingContainer. See actual
          settings for examples.
        </div>
      </section>

      {/* Dialog */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Dialog / Modal</h2>

        <Button variant="primary" onClick={() => setDialogOpen(true)}>
          Open Dialog
        </Button>

        <Dialog
          isOpen={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Example Dialog"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-text/80">
              This is an example dialog with smooth transitions and backdrop
              blur.
            </p>
            <Input placeholder="Type something..." />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                Confirm
              </Button>
            </div>
          </div>
        </Dialog>
      </section>

      <section className="border-t border-mid-gray/20 pt-8">
        <h3 className="text-lg font-semibold text-text mb-2">
          Key Features & Micro-Interactions:
        </h3>
        <ul className="list-disc list-inside space-y-2 text-sm text-text/80">
          <li>Smooth transitions (200ms) on all interactive elements</li>
          <li>Focus rings with proper color and offset</li>
          <li>Hover states with subtle background/border color changes</li>
          <li>Active/pressed states with scale animations</li>
          <li>Disabled states with reduced opacity</li>
          <li>Error states with red color scheme</li>
          <li>Loading states with spinners</li>
          <li>Icon support in inputs with dynamic coloring</li>
          <li>Character count in textareas with warning at 90%</li>
          <li>Removable badges with smooth transitions</li>
          <li>HeadlessUI-powered accessible components</li>
          <li>
            Dropdown animations (scale + opacity) for menus, selects, and
            dialogs
          </li>
        </ul>
      </section>
    </div>
  );
};
