import React, { useState } from "react";
import { Description, Field, Label } from "@headlessui/react";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
  label?: string;
  description?: string;
  error?: string;
  wrapperClassName?: string;
  showCharCount?: boolean;
  maxLength?: number;
}

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  label,
  description,
  error,
  wrapperClassName = "",
  showCharCount = false,
  maxLength,
  disabled,
  value,
  onFocus,
  onBlur,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const charCount =
    typeof value === "string"
      ? value.length
      : Array.isArray(value)
        ? value.join("").length
        : 0;

  const baseClasses =
    "w-full text-sm font-semibold bg-mid-gray/10 border rounded text-left transition-all duration-200 ease-in-out resize-y";

  const interactiveClasses = disabled
    ? "opacity-60 cursor-not-allowed bg-mid-gray/10 border-mid-gray/40"
    : error
      ? "border-red-500 hover:border-red-600 focus:border-red-600 focus:ring-2 focus:ring-red-500/20"
      : "border-mid-gray/80 hover:bg-logo-primary/10 hover:border-logo-primary focus:outline-none focus:bg-logo-primary/20 focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20";

  const variantClasses = {
    default: "px-3 py-2 min-h-[100px]",
    compact: "px-2 py-1 min-h-[80px]",
  };

  const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  const TextareaComponent = (
    <>
      <textarea
        className={`${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`}
        disabled={disabled}
        value={value}
        maxLength={maxLength}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-invalid={error ? "true" : "false"}
        {...props}
      />
      {showCharCount && maxLength && (
        <div
          className={`text-xs mt-1 text-right transition-colors duration-200 ${
            charCount > maxLength * 0.9
              ? "text-red-500 font-semibold"
              : "text-mid-gray/60"
          }`}
        >
          {charCount} / {maxLength}
        </div>
      )}
    </>
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
        {TextareaComponent}
        {error && (
          <Description className="text-xs text-red-500 mt-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
            {error}
          </Description>
        )}
      </Field>
    );
  }

  return TextareaComponent;
};
