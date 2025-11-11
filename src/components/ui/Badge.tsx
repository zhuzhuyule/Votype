import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md" | "lg";
  className?: string;
  onRemove?: () => void;
}

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  size = "md",
  className = "",
  onRemove,
}) => {
  const variantClasses = {
    primary: "bg-logo-primary text-white",
    secondary: "bg-mid-gray/20 text-text",
    success: "bg-green-500/20 text-green-600 border border-green-500/30",
    warning: "bg-yellow-500/20 text-yellow-600 border border-yellow-500/30",
    error: "bg-red-500/20 text-red-600 border border-red-500/30",
    info: "bg-blue-500/20 text-blue-600 border border-blue-500/30",
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-xs",
    lg: "px-4 py-1.5 text-sm",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-all duration-200 ${variantClasses[variant]} ${sizeClasses[size]} ${className} ${onRemove ? "pr-1.5" : ""}`}
    >
      <span>{children}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-current"
          type="button"
          aria-label="Remove"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </span>
  );
};

export default Badge;
