import React from "react";
import SelectComponent from "react-select";
import CreatableSelect from "react-select/creatable";
import type {
  ActionMeta,
  Props as ReactSelectProps,
  SingleValue,
  StylesConfig,
} from "react-select";

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
  onChange: (value: string | null, action: ActionMeta<SelectOption>) => void;
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

const baseBackground = "white";
const hoverBackground =
  "color-mix(in srgb, var(--color-mid-gray) 8%, transparent)";
const focusBackground =
  "color-mix(in srgb, var(--color-logo-primary) 15%, transparent)";
const neutralBorder =
  "color-mix(in srgb, var(--color-mid-gray) 15%, transparent)";

const selectStyles: StylesConfig<SelectOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderRadius: 6,
    borderColor: state.isFocused ? "var(--color-logo-primary)" : neutralBorder,
    boxShadow: state.isFocused
      ? "0 0 0 2px color-mix(in srgb, var(--color-logo-primary) 20%, transparent)"
      : "none",
    backgroundColor: state.isFocused ? focusBackground : baseBackground,
    fontSize: "0.875rem",
    color: "var(--color-text)",
    transition: "all 200ms ease",
    ":hover": {
      borderColor: "color-mix(in srgb, var(--color-mid-gray) 25%, transparent)",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    paddingInline: 12,
    paddingBlock: 8,
  }),
  input: (base) => ({
    ...base,
    color: "var(--color-text)",
    fontWeight: 400,
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--color-text)",
    fontWeight: 400,
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused
      ? "var(--color-logo-primary)"
      : "color-mix(in srgb, var(--color-mid-gray) 60%, transparent)",
    transition: "color 200ms ease",
    ":hover": {
      color: "var(--color-logo-primary)",
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "color-mix(in srgb, var(--color-mid-gray) 60%, transparent)",
    transition: "color 200ms ease",
    ":hover": {
      color: "var(--color-logo-primary)",
    },
  }),
  menu: (provided) => ({
    ...provided,
    zIndex: 30,
    backgroundColor: "white",
    color: "var(--color-text)",
    border:
      "1px solid color-mix(in srgb, var(--color-mid-gray) 15%, transparent)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? focusBackground
      : state.isFocused
        ? hoverBackground
        : "transparent",
    color: "var(--color-text)",
    cursor: state.isDisabled ? "not-allowed" : base.cursor,
    opacity: state.isDisabled ? 0.5 : 1,
    fontWeight: state.isSelected ? 500 : 400,
    transition: "background-color 150ms ease",
  }),
  placeholder: (base) => ({
    ...base,
    color: "color-mix(in srgb, var(--color-mid-gray) 50%, transparent)",
    fontWeight: 400,
  }),
};

export const Select: React.FC<SelectProps> = React.memo(
  ({
    value,
    options,
    placeholder,
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
    const selectValue = React.useMemo(() => {
      if (!value) return null;
      const existing = options.find((option) => option.value === value);
      if (existing) return existing;
      return { value, label: value, isDisabled: false };
    }, [value, options]);

    const handleChange = (
      option: SingleValue<SelectOption>,
      action: ActionMeta<SelectOption>,
    ) => {
      onChange(option?.value ?? null, action);
    };

    const sharedProps: Partial<ReactSelectProps<SelectOption, false>> = {
      className,
      classNamePrefix: "app-select",
      value: selectValue,
      options,
      onChange: handleChange,
      placeholder,
      isDisabled: disabled,
      isLoading,
      onBlur,
      isClearable,
      styles: selectStyles,
    };

    if (isCreatable) {
      return (
        <CreatableSelect<SelectOption, false>
          {...sharedProps}
          onCreateOption={onCreateOption}
          formatCreateLabel={formatCreateLabel}
        />
      );
    }

    return <SelectComponent<SelectOption, false> {...sharedProps} />;
  },
);

Select.displayName = "Select";
