import React from "react";

type BadgeVariant = "primary" | "secondary" | "success" | "warning" | "error";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  size = "sm",
  className = "",
}) => {
  const variantClasses: Record<BadgeVariant, string> = {
    primary:
      "bg-logo-primary/20 text-logo-primary border border-logo-primary/50",
    secondary: "bg-mid-gray/20 text-text border border-mid-gray/50",
    success: "bg-green-500/20 text-green-700 border border-green-500/50",
    warning: "bg-yellow-500/20 text-yellow-700 border border-yellow-500/50",
    error: "bg-red-500/20 text-red-700 border border-red-500/50",
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium transition-colors duration-150 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};

export default Badge;
