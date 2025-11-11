import React, { Fragment } from "react";
import { Listbox as HeadlessListbox, Transition } from "@headlessui/react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

export interface ListboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}

interface ListboxProps {
  value: string | null;
  onChange: (value: string) => void;
  options: ListboxOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export const Listbox: React.FC<ListboxProps> = ({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  disabled = false,
  className = "",
  label,
}) => {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={`${className}`}>
      {label && (
        <label className="text-sm font-medium mb-2 block">{label}</label>
      )}
      <HeadlessListbox
        value={value || ""}
        onChange={onChange}
        disabled={disabled}
        as="div"
        className="relative"
      >
        <HeadlessListbox.Button
          className={`relative w-full px-3 py-2 text-sm text-left bg-mid-gray/10 border border-mid-gray/80 rounded transition-all duration-150 flex items-center justify-between ${
            disabled
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-logo-primary/10 hover:border-logo-primary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary"
          }`}
        >
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDownIcon className="w-4 h-4 flex-shrink-0" />
        </HeadlessListbox.Button>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <HeadlessListbox.Options className="absolute left-0 right-0 mt-2 origin-top z-50 rounded-md shadow-lg bg-background border border-mid-gray/80 py-1 focus:outline-none max-h-60 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-mid-gray">
                No options available
              </div>
            ) : (
              options.map((option) => (
                <HeadlessListbox.Option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  as={Fragment}
                >
                  {({ active, selected }) => (
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors duration-150 ${
                        active && !option.disabled ? "bg-logo-primary/10" : ""
                      } ${selected ? "bg-logo-primary/20 font-semibold" : ""} ${
                        option.disabled ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      {option.icon && (
                        <option.icon className="w-4 h-4 flex-shrink-0" />
                      )}
                      <span className="flex-1 truncate">{option.label}</span>
                      {selected && (
                        <CheckIcon className="w-4 h-4 flex-shrink-0 text-logo-primary" />
                      )}
                    </button>
                  )}
                </HeadlessListbox.Option>
              ))
            )}
          </HeadlessListbox.Options>
        </Transition>
      </HeadlessListbox>
    </div>
  );
};
