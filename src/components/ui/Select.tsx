import React, { Fragment } from "react";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, X, Loader2 } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  isDisabled?: boolean;
};

type BaseProps = {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isClearable?: boolean;
  onChange: (value: string | null) => void;
  onBlur?: () => void;
  className?: string;
  formatCreateLabel?: (input: string) => string;
};

type CreatableProps = {
  isCreatable: true;
  onCreateOption: (value: string) => void;
};

type NonCreatableProps = {
  isCreatable?: false;
  onCreateOption?: never;
};

export type SelectProps = BaseProps & (CreatableProps | NonCreatableProps);

export const Select: React.FC<SelectProps> = React.memo(
  ({
    value,
    options,
    placeholder = "Select an option...",
    disabled,
    isLoading,
    isClearable = true,
    onChange,
    onBlur,
    className = "",
    isCreatable,
    formatCreateLabel,
    onCreateOption,
  }) => {
    const selectedOption = React.useMemo(() => {
      if (!value) return null;
      const existing = options.find((option) => option.value === value);
      if (existing) return existing;
      return { value, label: value, isDisabled: false };
    }, [value, options]);

    const handleClear = (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(null);
    };

    return (
      <Listbox
        value={value}
        onChange={onChange}
        disabled={disabled || isLoading}
      >
        {({ open }) => (
          <div className={`relative ${className}`}>
            <ListboxButton
              onBlur={onBlur}
              className={`relative w-full min-h-[40px] rounded-md border px-3 py-2 text-left text-sm font-semibold transition-all duration-200 ease-in-out ${
                disabled || isLoading
                  ? "cursor-not-allowed opacity-60 bg-mid-gray/10 border-mid-gray/40"
                  : "cursor-pointer bg-mid-gray/10 border-mid-gray/80 hover:bg-logo-primary/10 hover:border-logo-primary focus:outline-none focus:bg-logo-primary/20 focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="block truncate">
                  {selectedOption?.label || placeholder}
                </span>
                <span className="flex items-center gap-1 ml-2">
                  {isLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-logo-primary" />
                  )}
                  {isClearable && value && !isLoading && !disabled && (
                    <button
                      onClick={handleClear}
                      className="p-0.5 hover:bg-logo-primary/20 rounded transition-colors"
                      type="button"
                    >
                      <X className="h-3.5 w-3.5 text-mid-gray/80 hover:text-logo-primary" />
                    </button>
                  )}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ease-in-out ${
                      open ? "rotate-180" : ""
                    } ${disabled || isLoading ? "text-mid-gray/40" : "text-mid-gray/80"}`}
                  />
                </span>
              </span>
            </ListboxButton>
            <ListboxOptions className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md bg-background border border-mid-gray/30 shadow-lg origin-top transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0">
              {options.length === 0 ? (
                <div className="px-3 py-2 text-sm text-mid-gray">
                  No options available
                </div>
              ) : (
                options.map((option) => (
                  <ListboxOption
                    key={option.value}
                    value={option.value}
                    disabled={option.isDisabled}
                    as={Fragment}
                  >
                    {({ focus, selected }) => (
                      <li
                        className={`relative cursor-pointer select-none py-2 px-3 text-sm transition-colors duration-150 ${
                          focus
                            ? "bg-logo-primary/10"
                            : selected
                              ? "bg-logo-primary/20"
                              : ""
                        } ${option.isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <span
                          className={`block truncate ${selected ? "font-semibold" : "font-normal"}`}
                        >
                          {option.label}
                        </span>
                        {selected && (
                          <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                            <Check className="h-4 w-4 text-logo-primary" />
                          </span>
                        )}
                      </li>
                    )}
                  </ListboxOption>
                ))
              )}
            </ListboxOptions>
          </div>
        )}
      </Listbox>
    );
  },
);

Select.displayName = "Select";
