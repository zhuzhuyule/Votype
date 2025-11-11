import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary";
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  className = "",
}) => {
  const variantClasses = {
    primary: "bg-logo-primary",
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-opacity-20 ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
