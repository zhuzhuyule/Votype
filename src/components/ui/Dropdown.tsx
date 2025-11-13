import React, { useCallback, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuItem,
} from "@radix-ui/react-dropdown-menu";
import { Button, Text, Box, Flex } from "@radix-ui/themes";
import { ChevronDownIcon } from "@radix-ui/react-icons";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  options: DropdownOption[];
  className?: string;
  selectedValue: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
}

export const  Dropdown: React.FC<DropdownProps> = ({
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
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Box className={`relative ${className}`}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="surface"
            className={`w-full min-w-[200px] justify-between ${
              disabled
                ? "cursor-not-allowed opacity-60"
                : "hover:border-logo-primary hover:bg-logo-primary/10"
            }`}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Text truncate className="text-left">
              {selectedLabel || placeholder}
            </Text>
            <ChevronDownIcon
              width="16"
              height="16"
              className={`transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
          <DropdownMenuContent
            className="z-50 w-[220px] rounded-xl bg-background shadow-[0_10px_30px_rgba(15,15,15,0.25)] shadow-md shadow-gray-900/25"
            sideOffset={8}
            align="start"
          >
            <Box className="max-h-60 divide-y divide-mid-gray/10 overflow-y-auto scrollbar-thin scrollbar-thumb-mid-gray/30 scrollbar-track-transparent scrollbar-thumb-rounded-full scrollbar-track-rounded-full">
              {options.length === 0 ? (
                <Text
                  size="2"
                  color="gray"
                  className="px-3 py-2"
                  align="center"
                >
                  No options found
                </Text>
              ) : (
                options.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    className={`flex w-full items-center px-3 py-2 text-sm transition-colors duration-150 bg-transparent ${
                      option.disabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:bg-logo-primary/10 focus:bg-logo-primary/10 data-[state=checked]:bg-logo-primary/10"
                    }`}
                    onSelect={() => handleSelect(option.value)}
                    disabled={option.disabled}
                  >
                    <Text truncate className="w-full text-left">
                      {option.label}
                    </Text>
                  </DropdownMenuItem>
                ))
              )}
            </Box>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </Box>
    </DropdownMenu>
  );
};
