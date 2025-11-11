import React, { Fragment } from "react";
import { Menu as HeadlessMenu, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "lucide-react";

export interface MenuOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}

interface MenuProps {
  options: MenuOption[];
  selectedValue?: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
  className?: string;
}

export const Menu: React.FC<MenuProps> = ({
  options,
  selectedValue,
  onSelect,
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
  className = "",
}) => {
  const selectedOption = options.find((opt) => opt.value === selectedValue);

  const handleSelect = (value: string) => {
    const option = options.find((opt) => opt.value === value);
    if (!option?.disabled) {
      onSelect(value);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <HeadlessMenu>
        <HeadlessMenu.Button
          onClick={() => onRefresh?.()}
          disabled={disabled}
          className="px-3 py-2 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded min-w-[200px] text-left flex items-center justify-between transition-all duration-150 group data-[open]:bg-mid-gray/20 data-[open]:border-logo-primary disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-logo-primary/10 hover:enabled:border-logo-primary hover:enabled:cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-2"
        >
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDownIcon className="w-4 h-4 ml-2 transition-transform duration-200 group-data-[open]:rotate-180" />
        </HeadlessMenu.Button>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <HeadlessMenu.Items className="absolute left-0 right-0 mt-2 origin-top-left z-50 min-w-[200px] rounded-md shadow-lg bg-background border border-mid-gray/80 py-1 focus:outline-none">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-mid-gray">
                No options found
              </div>
            ) : (
              options.map((option) => (
                <HeadlessMenu.Item
                  key={option.value}
                  disabled={option.disabled}
                >
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      disabled={option.disabled}
                      className={`w-full px-3 py-2 text-sm text-left transition-colors duration-150 flex items-center gap-2 ${
                        active && !option.disabled
                          ? "bg-logo-primary/10 text-text"
                          : "text-text"
                      } ${
                        selectedValue === option.value
                          ? "bg-logo-primary/20 font-semibold"
                          : ""
                      } ${option.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {option.icon && (
                        <option.icon className="w-4 h-4 flex-shrink-0" />
                      )}
                      <span className="truncate">{option.label}</span>
                    </button>
                  )}
                </HeadlessMenu.Item>
              ))
            )}
          </HeadlessMenu.Items>
        </Transition>
      </HeadlessMenu>
    </div>
  );
};
