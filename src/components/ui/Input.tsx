import React from "react";
import * as Label from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";

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

    const baseClasses =
      "w-full px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded text-left transition-all duration-150";

    const interactiveClasses = disabled
      ? "opacity-60 cursor-not-allowed bg-mid-gray/10 border-mid-gray/40"
      : "hover:bg-logo-primary/10 hover:border-logo-primary focus:outline-none focus:bg-logo-primary/20 focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/30";

    const variantClasses = {
      default: "px-3 py-2",
      compact: "px-2 py-1",
    } as const;

    const InputComponent = (
      <input
        id={inputId}
        ref={ref}
        className={`${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className} ${
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500/30" : ""
        }`}
        disabled={disabled}
        {...props}
      />
    );

    const inputElement = (
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-mid-gray">
            {leftIcon}
          </div>
        )}
        {asChild ? <Slot ref={ref}>{InputComponent}</Slot> : InputComponent}
      </div>
    );

    if (label || description) {
      return (
        <div className="space-y-2">
          {label && (
            <Label.Root
              htmlFor={inputId}
              className="text-sm font-medium text-text"
            >
              {label}
            </Label.Root>
          )}
          {inputElement}
          {description && (
            <p className="text-xs text-text/60">{description}</p>
          )}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>
      );
    }

    return inputElement;
  }
);

Input.displayName = "Input";
