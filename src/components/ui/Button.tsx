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
      "text-white bg-background-ui hover:bg-background-ui/90 active:bg-background-ui/95 focus:ring-background-ui/40",
    secondary:
      "bg-mid-gray/10 text-text hover:bg-mid-gray/15 active:bg-mid-gray/20 focus:ring-mid-gray/20",
    danger:
      "text-white bg-red-600 hover:bg-red-700 active:bg-red-800 focus:ring-red-500/40",
    ghost:
      "text-current hover:bg-mid-gray/8 active:bg-mid-gray/12 focus:ring-mid-gray/20",
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
