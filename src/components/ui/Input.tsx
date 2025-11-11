import React, { useState, useRef, useEffect } from "react";
import { Description, Field, Label } from "@headlessui/react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
  label?: string;
  description?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  wrapperClassName?: string;
}

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  label,
  description,
  error,
  leftIcon,
  rightIcon,
  wrapperClassName = "",
  onFocus,
  onBlur,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const baseClasses =
    "w-full text-sm font-semibold bg-mid-gray/10 border rounded text-left transition-all duration-200 ease-in-out";

  const interactiveClasses = disabled
    ? "opacity-60 cursor-not-allowed bg-mid-gray/10 border-mid-gray/40"
    : error
      ? "border-red-500 hover:border-red-600 focus:border-red-600 focus:ring-2 focus:ring-red-500/20"
      : "border-mid-gray/80 hover:bg-logo-primary/10 hover:border-logo-primary focus:outline-none focus:bg-logo-primary/20 focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20";

  const variantClasses = {
    default: "px-3 py-2",
    compact: "px-2 py-1",
  } as const;

  const paddingClasses = leftIcon
    ? "pl-10"
    : rightIcon
      ? "pr-10"
      : variantClasses[variant];

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  const InputComponent = (
    <div className="relative">
      {leftIcon && (
        <div
          className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
            isFocused
              ? "text-logo-primary"
              : error
                ? "text-red-500"
                : "text-mid-gray/80"
          }`}
        >
          {leftIcon}
        </div>
      )}
      <input
        ref={inputRef}
        className={`${baseClasses} ${paddingClasses} ${interactiveClasses} ${className}`}
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-invalid={error ? "true" : "false"}
        {...props}
      />
      {rightIcon && (
        <div
          className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
            isFocused
              ? "text-logo-primary"
              : error
                ? "text-red-500"
                : "text-mid-gray/80"
          }`}
        >
          {rightIcon}
        </div>
      )}
    </div>
  );

  if (label || description || error) {
    return (
      <Field className={wrapperClassName}>
        {label && (
          <Label className="block text-sm font-semibold mb-1.5 text-text">
            {label}
          </Label>
        )}
        {description && !error && (
          <Description className="text-xs text-mid-gray/80 mb-1.5">
            {description}
          </Description>
        )}
        {InputComponent}
        {error && (
          <Description className="text-xs text-red-500 mt-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
            {error}
          </Description>
        )}
      </Field>
    );
  }

  return InputComponent;
};
