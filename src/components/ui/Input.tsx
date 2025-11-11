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
    "px-3 py-2 text-sm font-normal bg-white border border-mid-gray/15 rounded-md text-left transition-all duration-200 placeholder:text-mid-gray/40";

  const interactiveClasses = disabled
    ? "opacity-50 cursor-not-allowed bg-mid-gray/5 border-mid-gray/10"
    : "hover:border-mid-gray/25 focus:outline-none focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20";

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
