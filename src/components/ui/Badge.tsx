import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "success" | "warning" | "error" | "info";
  className?: string;
  onRemove?: () => void;
}

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  className = "",
  onRemove,
}) => {
  const variantClasses = {
    primary: "bg-logo-primary text-white",
    secondary: "bg-mid-gray/20 text-text border border-mid-gray/40",
    success: "bg-green-500 text-white",
    warning: "bg-yellow-500 text-white",
    error: "bg-red-500 text-white",
    info: "bg-blue-500 text-white",
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors duration-200 ${variantClasses[variant]} ${className}`}
      role="status"
    >
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-1 p-0.5 hover:bg-black/20 rounded-full transition-colors"
          aria-label="Remove badge"
          type="button"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
};

export default Badge;
export { Badge };
