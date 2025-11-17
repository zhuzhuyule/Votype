import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Box, Select, Text, TextField } from "@radix-ui/themes";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  ariaLabel?: string;
  ariaLabelledBy?: string;
  enableFilter?: boolean; // 新增：是否启用过滤功能
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  disabled = false,
  onRefresh,
  className = "",
  placeholder,
  ariaLabel,
  ariaLabelledBy,
  enableFilter = false, // 默认关闭过滤功能
}) => {
  const { t } = useTranslation();
  const defaultPlaceholder = t("ui.selectOption");
  const [filterText, setFilterText] = useState("");

  // 过滤选项
  const filteredOptions = useMemo(() => {
    if (!enableFilter || !filterText.trim()) {
      return options;
    }

    const lowerFilter = filterText.toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(lowerFilter) ||
        option.value.toLowerCase().includes(lowerFilter),
    );
  }, [options, enableFilter, filterText]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !disabled && onRefresh) {
        onRefresh();
      }
      // 关闭时清空过滤文本
      if (!open) {
        setFilterText("");
      }
    },
    [disabled, onRefresh],
  );

  const handleValueChange = useCallback(
    (value: string) => {
      if (disabled) return;
      onSelect(value);
      setFilterText(""); // 选择后清空过滤文本
    },
    [disabled, onSelect],
  );

  const handleFilterChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setFilterText(event.target.value);
    },
    [],
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
        placeholder={placeholder || defaultPlaceholder}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      />

      <Select.Content
        position="popper"
        className="max-h-60 w-auto min-w-[200px] shadow-lg"
      >
        {enableFilter && (
          <Box className="pb-2">
            <TextField.Root
              placeholder={t("ui.filterOptions") || "Filter..."}
              value={filterText}
              onChange={handleFilterChange}
              onClick={(e) => e.stopPropagation()} // 防止选择框关闭
            >
              <TextField.Slot>
                <MagnifyingGlassIcon />
              </TextField.Slot>
            </TextField.Root>
          </Box>
        )}

        {filteredOptions.length === 0 ? (
          <Text size="2" color="gray" align="center" className="px-3 py-2">
            {filterText.trim()
              ? t("ui.noMatchingOptions") || "No matching options"
              : t("ui.notAvailable")}
          </Text>
        ) : (
          filteredOptions.map((option) => (
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
