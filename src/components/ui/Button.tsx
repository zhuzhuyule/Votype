import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  isLoading = false,
  disabled,
  ...props
}) => {
  const baseClasses =
    "font-medium rounded focus:outline-none transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-95";

  const variantClasses = {
    primary:
      "text-white bg-background-ui hover:bg-background-ui/80 hover:shadow-md focus:ring-2 focus:ring-background-ui/50 focus:ring-offset-2 focus:ring-offset-background",
    secondary:
      "bg-mid-gray/10 hover:bg-background-ui/30 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-mid-gray/50 focus:ring-offset-2 focus:ring-offset-background",
    danger:
      "text-white bg-red-600 hover:bg-red-700 hover:shadow-md focus:ring-2 focus:ring-red-500/50 focus:ring-offset-2 focus:ring-offset-background",
    ghost:
      "text-current hover:bg-mid-gray/10 focus:bg-mid-gray/20 focus:ring-2 focus:ring-mid-gray/30",
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-4 py-[5px] text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
};
