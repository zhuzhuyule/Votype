import React from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { ChevronDown, Check } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  options: DropdownOption[];
  className?: string;
  selectedValue: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
}) => {
  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );

  const handleOpen = () => {
    if (onRefresh) onRefresh();
  };

  return (
    <Menu as="div" className={`relative ${className}`}>
      {({ open }) => (
        <>
          <MenuButton
            onClick={handleOpen}
            disabled={disabled}
            className={`px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded min-w-[200px] text-left flex items-center justify-between transition-all duration-200 ease-in-out ${
              disabled
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-logo-primary/10 cursor-pointer hover:border-logo-primary focus:outline-none focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20"
            }`}
          >
            <span className="truncate">
              {selectedOption?.label || placeholder}
            </span>
            <ChevronDown
              className={`w-4 h-4 ml-2 transition-transform duration-200 ease-in-out ${
                open ? "rotate-180" : ""
              }`}
            />
          </MenuButton>
          <MenuItems
            anchor="bottom start"
            className="absolute z-50 mt-1 w-[var(--button-width)] min-w-[200px] bg-background border border-mid-gray/80 rounded-md shadow-lg overflow-hidden max-h-60 overflow-y-auto origin-top transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
          >
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-mid-gray">
                No options found
              </div>
            ) : (
              options.map((option) => (
                <MenuItem key={option.value} disabled={option.disabled}>
                  {({ focus }) => (
                    <button
                      onClick={() => onSelect(option.value)}
                      className={`w-full px-3 py-2 text-sm text-left flex items-center justify-between transition-colors duration-150 ${
                        focus ? "bg-logo-primary/10" : ""
                      } ${
                        selectedValue === option.value
                          ? "bg-logo-primary/20 font-semibold"
                          : ""
                      } ${option.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <span className="truncate">{option.label}</span>
                      {selectedValue === option.value && (
                        <Check className="w-4 h-4 ml-2 text-logo-primary" />
                      )}
                    </button>
                  )}
                </MenuItem>
              ))
            )}
          </MenuItems>
        </>
      )}
    </Menu>
  );
};
