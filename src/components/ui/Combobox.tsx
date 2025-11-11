import React, { Fragment, useState } from "react";
import {
  Combobox as HeadlessCombobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ComboboxProps {
  value: string | null;
  options: ComboboxOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
  description?: string;
  error?: string;
}

export const Combobox: React.FC<ComboboxProps> = ({
  value,
  options,
  onChange,
  placeholder = "Search...",
  disabled = false,
  className = "",
  label,
  description,
  error,
}) => {
  const [query, setQuery] = useState("");

  const selectedOption = options.find((option) => option.value === value);

  const filteredOptions =
    query === ""
      ? options
      : options.filter((option) =>
          option.label.toLowerCase().includes(query.toLowerCase()),
        );

  const handleChange = (newValue: string | null) => {
    onChange(newValue);
    setQuery("");
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-semibold mb-1.5 text-text">
          {label}
        </label>
      )}
      {description && !error && (
        <p className="text-xs text-mid-gray/80 mb-1.5">{description}</p>
      )}
      <HeadlessCombobox value={value} onChange={handleChange} disabled={disabled}>
        {({ open }) => (
          <div className="relative">
            <div className="relative">
              <ComboboxInput
                className={`w-full rounded-md border px-3 py-2 pr-10 text-sm font-semibold text-left transition-all duration-200 ease-in-out ${
                  disabled
                    ? "cursor-not-allowed opacity-60 bg-mid-gray/10 border-mid-gray/40"
                    : error
                      ? "border-red-500 hover:border-red-600 focus:border-red-600 focus:ring-2 focus:ring-red-500/20"
                      : "bg-mid-gray/10 border-mid-gray/80 hover:bg-logo-primary/10 hover:border-logo-primary focus:outline-none focus:bg-logo-primary/20 focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20"
                }`}
                displayValue={(value: string | null) =>
                  options.find((option) => option.value === value)?.label || ""
                }
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
              />
              <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronDown
                  className={`h-4 w-4 transition-all duration-200 ease-in-out ${
                    open ? "rotate-180" : ""
                  } ${disabled ? "text-mid-gray/40" : "text-mid-gray/80"}`}
                />
              </ComboboxButton>
            </div>
            <ComboboxOptions className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md bg-background border border-mid-gray/30 shadow-lg origin-top transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0">
              {filteredOptions.length === 0 ? (
                <div className="relative cursor-default select-none py-2 px-3 text-sm text-mid-gray">
                  {query === "" ? "No options available" : "No results found"}
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <ComboboxOption
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
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
                        } ${option.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
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
                  </ComboboxOption>
                ))
              )}
            </ComboboxOptions>
          </div>
        )}
      </HeadlessCombobox>
      {error && (
        <p className="text-xs text-red-500 mt-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
          {error}
        </p>
      )}
    </div>
  );
};
