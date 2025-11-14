import React, { useCallback } from "react";
import { Select, Text } from "@radix-ui/themes";
import { ChevronDownIcon } from "@radix-ui/react-icons";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  options: DropdownOption[];
  className?: string;
  selectedValue: string | undefined;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}) => {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !disabled && onRefresh) {
        onRefresh();
      }
    },
    [disabled, onRefresh],
  );

  const handleValueChange = useCallback(
    (value: string) => {
      if (disabled) return;
      onSelect(value);
    },
    [disabled, onSelect],
  );

  return (
    <Select.Root
      value={selectedValue}
      onValueChange={handleValueChange}
      onOpenChange={handleOpenChange}
      disabled={disabled}
    >
      <Select.Trigger
        variant="surface"
        className={`w-auto min-w-[200px] shadow-sm ${className}`}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      />

      <Select.Content
        position="popper"
        className="max-h-60 w-auto min-w-[200px] shadow-lg"
      >
        {options.length === 0 ? (
          <Text size="2" color="gray" align="center" className="px-3 py-2">
            No options found
          </Text>
        ) : (
          options.map((option) => (
            <Select.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </Select.Item>
          ))
        )}
      </Select.Content>
    </Select.Root>
  );
};
