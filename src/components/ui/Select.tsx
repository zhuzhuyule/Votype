import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
  isDisabled?: boolean;
};

export type ActionMeta<TOption> = {
  action: "select-option" | "clear" | "create-option";
  option?: TOption;
  removedValues?: TOption[];
};

type BaseProps = {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isClearable?: boolean;
  onChange: (value: string | null, actionMeta: ActionMeta<SelectOption>) => void;
  onBlur?: () => void;
  className?: string;
  formatCreateLabel?: (input: string) => string;
  position?: "popper" | "item-aligned";
  onRefresh?: () => void;
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

const triggerBaseClasses =
  "flex items-center justify-between w-full min-h-[40px] rounded-lg bg-background border border-mid-gray/20 px-3 py-2 text-sm font-medium text-text transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:border-logo-primary/50";

const viewportClasses =
  "max-h-64 overflow-y-auto py-1.5 px-1 space-y-1";

const optionClasses =
  "group flex items-center justify-between px-3 py-2 rounded-md text-sm cursor-pointer transition-colors duration-150 shadow-sm bg-transparent";

const createRowClasses =
  "flex items-center gap-2 px-3 py-2";

const spinnerClasses =
  "h-4 w-4 animate-spin rounded-full border-2 border-transparent border-t-logo-primary";

const selectActionMeta = (option: SelectOption | undefined): ActionMeta<SelectOption> => ({
  action: "select-option",
  option,
});

const clearActionMeta = (removed: SelectOption[]): ActionMeta<SelectOption> => ({
  action: "clear",
  removedValues: removed,
});

const createActionMeta = (option: SelectOption): ActionMeta<SelectOption> => ({
  action: "create-option",
  option,
});

export const Select: React.FC<SelectProps> = React.memo(
  ({
    value,
    options,
    placeholder = "Select...",
    disabled = false,
    isLoading = false,
    isClearable = true,
    onChange,
    onBlur,
    className = "",
    isCreatable,
    onCreateOption,
    formatCreateLabel,
    position = "item-aligned",
    onRefresh,
  }) => {
    const [, setOpen] = useState(false);
    const [newValue, setNewValue] = useState("");

    const selectedOption = useMemo(
      () => options.find((option) => option.value === value),
      [options, value],
    );

    const handleValueChange = useCallback(
      (val: string) => {
        const option =
          options.find((item) => item.value === val) ??
          (val
            ? { value: val, label: val, isDisabled: false }
            : undefined);

        onChange(option?.value ?? null, selectActionMeta(option));
      },
      [options, onChange],
    );

    const handleClear = useCallback(() => {
      if (disabled || isLoading || !selectedOption) {
        return;
      }

      onChange(null, clearActionMeta([selectedOption]));
    }, [disabled, isLoading, onChange, selectedOption]);

    const handleCreate = useCallback(() => {
      if (!isCreatable || !onCreateOption) {
        return;
      }

      const trimmed = newValue.trim();
      if (!trimmed) return;

      const option: SelectOption = {
        value: trimmed,
        label: trimmed,
      };

      onCreateOption(trimmed);
      onChange(trimmed, createActionMeta(option));
      setNewValue("");
      setOpen(false);
    }, [isCreatable, newValue, onChange, onCreateOption]);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleCreate();
        }
      },
      [handleCreate],
    );

    const handleOpenChange = useCallback(
      (isOpen: boolean) => {
        setOpen(isOpen);
        if (isOpen && onRefresh) {
          onRefresh();
        }
        if (!isOpen) {
          onBlur?.();
        }
      },
      [onBlur, onRefresh],
    );

    const creationLabel = useMemo(() => {
      const trimmed = newValue.trim();
      if (!trimmed) {
        return undefined;
      }
      return formatCreateLabel
        ? formatCreateLabel(trimmed)
        : `Add "${trimmed}"`;
    }, [formatCreateLabel, newValue]);

    const placeholderLabel = selectedOption?.label ?? placeholder;
    const showClear = Boolean(
      isClearable && !disabled && !isLoading && selectedOption?.value,
    );

    return (
      <RadixSelect.Root
        value={selectedOption?.value}
        onValueChange={handleValueChange}
        onOpenChange={handleOpenChange}
        disabled={disabled}
      >
        <div className={`relative ${className}`}>
          <RadixSelect.Trigger
            className={`${triggerBaseClasses} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <RadixSelect.Value placeholder={placeholderLabel} />
            <div className="flex items-center gap-2">
              {isLoading ? (
                <span className={spinnerClasses} />
              ) : (
                <ChevronsUpDown className="h-4 w-4 text-mid-gray" />
              )}
            </div>
          </RadixSelect.Trigger>

          {showClear && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-background text-mid-gray transition hover:text-logo-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              onClick={(event) => {
                event.stopPropagation();
                handleClear();
              }}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className="z-30 w-full min-w-[240px] rounded-2xl bg-background shadow-[0_10px_30px_rgba(15,15,15,0.25)] backdrop-blur-md"
            position={position}
            sideOffset={8}
          >
            <RadixSelect.Viewport className={viewportClasses}>
              {isCreatable && (
                <>
                  <div className={createRowClasses}>
                    <input
                      type="text"
                      className="flex-1 rounded-md border border-mid-gray/20 bg-transparent px-2 py-1 text-sm text-text focus:border-logo-primary focus:outline-none focus:ring-2 focus:ring-logo-primary/30"
                      placeholder="Add new option"
                      value={newValue}
                      onChange={(event) => setNewValue(event.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                    <button
                      type="button"
                      className="rounded-full bg-logo-primary px-3 py-1 text-xs font-semibold text-white transition hover:bg-logo-primary/90 disabled:cursor-not-allowed disabled:bg-mid-gray/40 disabled:text-white/60"
                      onClick={handleCreate}
                      disabled={!newValue.trim()}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  {creationLabel && (
                    <p className="px-3 pt-1 text-[11px] uppercase tracking-wide text-mid-gray/80">
                      {creationLabel}
                    </p>
                  )}
                </>
              )}
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.isDisabled}
                  className={`${optionClasses} ${
                    option.isDisabled
                      ? "cursor-not-allowed opacity-60"
                      : "hover:bg-logo-primary/10 focus:bg-logo-primary/10 data-[state=checked]:bg-logo-primary/10"
                  }`}
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="text-logo-primary">
                    <Check className="h-4 w-4" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    );
  },
);

Select.displayName = "Select";
