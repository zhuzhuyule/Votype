import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  ...props
}) => {
  const baseClasses =
    "px-3 py-2 text-sm font-normal bg-surface border border-border rounded-md text-left transition-all duration-200 placeholder:text-text-tertiary";

  const interactiveClasses = disabled
    ? "opacity-50 cursor-not-allowed bg-card border-border"
    : "hover:border-border-strong focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

  const variantClasses = {
    default: "px-3 py-2.5",
    compact: "px-2.5 py-1.5",
  } as const;

  return (
    <input
      className={`${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
