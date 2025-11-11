import React from "react";

interface CardProps {
  children: React.ReactNode;
  elevation?: 0 | 1 | 2;
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
  padding?: "sm" | "md" | "lg";
}

const elevationClasses = {
  0: "border border-border",
  1: "border border-border shadow-sm",
  2: "border border-border shadow-md",
};

const paddingClasses = {
  sm: "p-md",
  md: "p-lg",
  lg: "p-xl",
};

export const Card: React.FC<CardProps> = ({
  children,
  elevation = 0,
  interactive = false,
  onClick,
  className = "",
  padding = "md",
}) => {
  return (
    <div
      className={`
        bg-surface rounded-md
        ${elevationClasses[elevation]}
        ${paddingClasses[padding]}
        ${interactive ? "cursor-pointer transition-all duration-200 hover:shadow-lg" : ""}
        ${className}
      `}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
