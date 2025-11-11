import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "font-medium rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-0";

  const variantClasses = {
    primary:
      "text-white bg-accent hover:bg-accent-600 active:bg-accent-700 focus:ring-accent/40",
    secondary:
      "bg-card text-text hover:bg-background active:bg-border focus:ring-border-strong",
    danger:
      "text-white bg-error hover:bg-red-700 active:bg-red-800 focus:ring-error/40",
    ghost: "text-text hover:bg-background active:bg-card focus:ring-border",
  };

  const sizeClasses = {
    sm: "px-2.5 py-1 text-xs",
    md: "px-3.5 py-2 text-sm",
    lg: "px-4 py-2.5 text-base",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
