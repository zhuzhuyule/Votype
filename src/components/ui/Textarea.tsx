import React from "react";
import * as Label from "@radix-ui/react-label";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
  label?: string;
  error?: string;
  description?: string;
  showCharCount?: boolean;
}

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  label,
  error,
  description,
  showCharCount = false,
  id,
  value,
  ...props
}) => {
  const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
  
  const baseClasses =
    "w-full px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded text-left transition-[background-color,border-color] duration-150 hover:bg-logo-primary/10 hover:border-logo-primary focus:outline-none focus:bg-logo-primary/10 focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/30 resize-y";

  const variantClasses = {
    default: "px-3 py-2 min-h-[100px]",
    compact: "px-2 py-1 min-h-[80px]",
  };

  const textareaElement = (
    <div className="relative">
      <textarea
        id={textareaId}
        className={`${baseClasses} ${variantClasses[variant]} ${className} ${
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500/30" : ""
        }`}
        value={value}
        {...props}
      />
      {showCharCount && (
        <div className="absolute bottom-2 right-2 text-xs text-text/60 bg-background px-1 rounded">
          {typeof value === "string" ? value.length : 0}/{props.maxLength}
        </div>
      )}
    </div>
  );

  if (label || description) {
    return (
      <div className="space-y-2">
        {label && (
          <Label.Root
            htmlFor={textareaId}
            className="text-sm font-medium text-text"
          >
            {label}
          </Label.Root>
        )}
        {textareaElement}
        {description && (
          <p className="text-xs text-text/60">{description}</p>
        )}
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
    );
  }

  return textareaElement;
};
