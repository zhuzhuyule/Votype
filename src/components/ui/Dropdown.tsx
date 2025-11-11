import React, { useCallback, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuItem,
} from "@radix-ui/react-dropdown-menu";

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

const triggerClasses =
  "w-full min-w-[200px] rounded-lg bg-background px-3 py-2 text-sm font-semibold text-left transition-all duration-150 flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const contentClasses =
  "z-50 w-[220px] rounded-xl bg-background shadow-[0_10px_30px_rgba(15,15,15,0.25)]";

const viewportClasses =
  "max-h-60 divide-y divide-mid-gray/10 overflow-y-auto";

const optionClasses =
  "flex w-full items-center px-3 py-2 text-sm transition-colors duration-150 bg-transparent";

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
}) => {
  const [open, setOpen] = useState(false);

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === selectedValue)?.label,
    [options, selectedValue],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && !disabled && onRefresh) {
        onRefresh();
      }

      setOpen(nextOpen);
    },
    [disabled, onRefresh],
  );

  const handleSelect = useCallback(
    (value: string) => {
      if (disabled) return;
      onSelect(value);
      setOpen(false);
    },
    [disabled, onSelect],
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} disabled={disabled}>
      <div className={`relative ${className}`}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${triggerClasses} ${
              disabled
                ? "cursor-not-allowed opacity-60"
                : "hover:border-logo-primary hover:bg-logo-primary/10"
            }`}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <span className="truncate">
              {selectedLabel || placeholder}
            </span>
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
          <DropdownMenuContent
            className={contentClasses}
            sideOffset={8}
            align="start"
          >
            <div className={viewportClasses}>
              {options.length === 0 ? (
                <div className="px-3 py-2 text-sm text-mid-gray">
                  No options found
                </div>
              ) : (
                options.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    className={`${optionClasses} ${
                      option.disabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:bg-logo-primary/10 focus:bg-logo-primary/10 data-[state=checked]:bg-logo-primary/10"
                    }`}
                    onSelect={() => handleSelect(option.value)}
                    disabled={option.disabled}
                  >
                    <span className="truncate">{option.label}</span>
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </div>
    </DropdownMenu>
  );
};
