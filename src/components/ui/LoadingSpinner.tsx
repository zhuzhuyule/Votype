import React from "react";

interface LoadingSpinnerProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  color?: "primary" | "secondary" | "current";
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "md",
  className = "",
  color = "primary",
}) => {
  const sizeClasses = {
    xs: "w-3 h-3",
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
    xl: "w-8 h-8",
  };

  const colorClasses = {
    primary: "border-logo-primary border-t-transparent",
    secondary: "border-mid-gray/80 border-t-transparent",
    current: "border-current border-t-transparent",
  };

  return (
    <div
      className={`${sizeClasses[size]} border-2 ${colorClasses[color]} rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
};

interface LoadingDotsProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  color?: "primary" | "secondary" | "current";
}

export const LoadingDots: React.FC<LoadingDotsProps> = ({
  size = "md",
  className = "",
  color = "primary",
}) => {
  const dotSizeClasses = {
    sm: "w-1 h-1",
    md: "w-1.5 h-1.5",
    lg: "w-2 h-2",
  };

  const colorClasses = {
    primary: "bg-logo-primary",
    secondary: "bg-mid-gray/80",
    current: "bg-current",
  };

  return (
    <div className={`flex items-center gap-1 ${className}`} role="status">
      <div
        className={`${dotSizeClasses[size]} ${colorClasses[color]} rounded-full animate-bounce`}
        style={{ animationDelay: "0ms" }}
      />
      <div
        className={`${dotSizeClasses[size]} ${colorClasses[color]} rounded-full animate-bounce`}
        style={{ animationDelay: "150ms" }}
      />
      <div
        className={`${dotSizeClasses[size]} ${colorClasses[color]} rounded-full animate-bounce`}
        style={{ animationDelay: "300ms" }}
      />
      <span className="sr-only">Loading...</span>
    </div>
  );
};

interface LoadingPulseProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const LoadingPulse: React.FC<LoadingPulseProps> = ({
  size = "md",
  className = "",
}) => {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  return (
    <div className={`relative ${sizeClasses[size]} ${className}`} role="status">
      <div className="absolute inset-0 bg-logo-primary/20 rounded-full animate-ping" />
      <div className="absolute inset-0 bg-logo-primary/40 rounded-full animate-pulse" />
      <span className="sr-only">Loading...</span>
    </div>
  );
};
