import {
  Box,
  Flex,
  Popover,
  ScrollArea,
  Select,
  Text,
  TextField,
} from "@radix-ui/themes";
import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react";
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
  enableFilter?: boolean; // 是否启用过滤功能
}

// Popover trigger button 样式（与 Select.Trigger 保持一致）
const triggerClasses =
  "flex items-center justify-between min-h-[32px] w-full min-w-[200px] rounded-[var(--radius-2)] bg-[var(--color-surface)] border border-[var(--gray-a7)] px-3 py-1.5 text-sm text-[var(--gray-12)] transition hover:border-[var(--gray-a8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)] disabled:opacity-50 disabled:cursor-not-allowed";

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
  enableFilter = false,
}) => {
  const { t } = useTranslation();
  const defaultPlaceholder = t("common.selectOption");
  const [filterText, setFilterText] = useState("");
  const [open, setOpen] = useState(false);

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
    (nextOpen: boolean) => {
      if (disabled) {
        setOpen(false);
        return;
      }
      if (nextOpen && onRefresh) {
        onRefresh();
      }
      setOpen(nextOpen);
      // 关闭时清空过滤文本
      if (!nextOpen) {
        setFilterText("");
      }
    },
    [disabled, onRefresh],
  );

  const handleValueChange = useCallback(
    (value: string) => {
      if (disabled) return;
      onSelect(value);
      setFilterText("");
    },
    [disabled, onSelect],
  );

  const selectedLabel = useMemo(() => {
    const selected = options.find((o) => o.value === selectedValue);
    return selected?.label;
  }, [options, selectedValue]);

  // 当启用过滤功能时，使用 Popover 实现（解决 Select 焦点管理问题）
  if (enableFilter) {
    return (
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger>
          <button
            type="button"
            className={`${triggerClasses} ${className}`}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
          >
            <span className="truncate text-left flex-1">
              {selectedLabel || placeholder || defaultPlaceholder}
            </span>
            <IconChevronDown size={16} className="opacity-50 shrink-0" />
          </button>
        </Popover.Trigger>
        <Popover.Content
          size="1"
          style={{ minWidth: 280, padding: 0 }}
          side="bottom"
          align="start"
        >
          {/* 搜索输入框 */}
          <Box className="p-2 border-b border-(--gray-a5)">
            <TextField.Root
              placeholder={t("common.filterOptions")}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              disabled={disabled}
              size="2"
            >
              <TextField.Slot>
                <IconSearch size={14} />
              </TextField.Slot>
            </TextField.Root>
          </Box>

          {/* 选项列表 */}
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ maxHeight: 240 }}
          >
            <Box className="py-1">
              {filteredOptions.length === 0 ? (
                <Text
                  size="2"
                  color="gray"
                  align="center"
                  className="px-3 py-4 block"
                >
                  {filterText.trim()
                    ? t("common.noMatchingOptions")
                    : t("common.noOptionsFound")}
                </Text>
              ) : (
                filteredOptions.map((option) => {
                  const isActive = option.value === selectedValue;
                  return (
                    <Box
                      key={option.value}
                      onClick={() => {
                        if (option.disabled) return;
                        handleValueChange(option.value);
                        setOpen(false);
                      }}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={option.disabled ? -1 : 0}
                      onKeyDown={(e) => {
                        if (
                          (e.key === "Enter" || e.key === " ") &&
                          !option.disabled
                        ) {
                          e.preventDefault();
                          handleValueChange(option.value);
                          setOpen(false);
                        }
                      }}
                      className={`px-3 py-2 cursor-pointer transition-colors ${
                        option.disabled
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-(--gray-a3)"
                      } ${isActive ? "bg-(--accent-a3)" : ""}`}
                    >
                      <Flex justify="between" align="center" gap="2">
                        <Text size="2" className="truncate">
                          {option.label}
                        </Text>
                        {isActive && (
                          <IconCheck
                            size={16}
                            className="text-(--accent-9) shrink-0"
                          />
                        )}
                      </Flex>
                    </Box>
                  );
                })
              )}
            </Box>
          </ScrollArea>
        </Popover.Content>
      </Popover.Root>
    );
  }

  // 不启用过滤时，使用原来的 Select 实现
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
        {filteredOptions.length === 0 ? (
          <Text size="2" color="gray" align="center" className="px-3 py-2">
            {t("common.noOptionsFound")}
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
