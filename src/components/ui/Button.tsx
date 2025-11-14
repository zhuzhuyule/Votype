import React from "react";
import { Button as RadixButton } from "@radix-ui/themes";

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
  const getRadixVariant = () => {
    switch (variant) {
      case "primary":
        return "solid";
      case "secondary":
        return "outline";
      case "danger":
        return "solid";
      case "ghost":
        return "ghost";
      default:
        return "solid";
    }
  };

  const getRadixColor = () => {
    switch (variant) {
      case "primary":
        return "indigo";
      case "secondary":
        return "gray";
      case "danger":
        return "red";
      case "ghost":
        return "gray";
      default:
        return "indigo";
    }
  };

  const getRadixSize = () => {
    switch (size) {
      case "sm":
        return "1";
      case "md":
        return "2";
      case "lg":
        return "3";
      default:
        return "2";
    }
  };

  return (
    <RadixButton
      variant={getRadixVariant()}
      color={getRadixColor()}
      size={getRadixSize()}
      disabled={disabled || isLoading}
      className={`${className} ${
        isLoading ? "cursor-wait" : ""
      }`}
      {...props}
    >
      {isLoading && (
        <RadixButton.Loading>
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
        </RadixButton.Loading>
      )}
      <span className={isLoading ? "opacity-50" : ""}>
        {children}
      </span>
    </RadixButton>
  );
};
