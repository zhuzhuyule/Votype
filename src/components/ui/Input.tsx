import React from "react";
import { Text, TextField } from "@radix-ui/themes";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  description?: string;
  asChild?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = "",
      variant = "default",
      disabled,
      label,
      error,
      leftIcon,
      description,
      id,
      asChild = false,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

    const getSize = () => {
      switch (variant) {
        case "compact":
          return "1";
        default:
          return "2";
      }
    };

    const textFieldComponent = (
      <TextField.Root
        size={getSize()}
        disabled={disabled}
        className={className}
        color={error ? "red" : undefined}
        id={inputId}
        ref={ref}
        placeholder={props.placeholder}
        value={props.value}
        onChange={props.onChange}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
        type={props.type}
        autoComplete={props.autoComplete}
        required={props.required}
        maxLength={props.maxLength}
        minLength={props.minLength}
        pattern={props.pattern}
        step={props.step}
        min={props.min}
        max={props.max}
      >
        {leftIcon && (
          <TextField.Slot side="left">
            {leftIcon}
          </TextField.Slot>
        )}
      </TextField.Root>
    );

    if (label || description || error) {
      return (
        <div className="space-y-2">
          {label && (
            <Text
              as="label"
              htmlFor={inputId}
              size="2"
              weight="medium"
              className="text-text"
            >
              {label}
            </Text>
          )}
          {textFieldComponent}
          {description && (
            <Text size="1" color="gray" className="text-text/60">
              {description}
            </Text>
          )}
          {error && (
            <Text size="2" color="red">
              {error}
            </Text>
          )}
        </div>
      );
    }

    return textFieldComponent;
  }
);

Input.displayName = "Input";
