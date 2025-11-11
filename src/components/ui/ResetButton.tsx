import React from "react";
import { Button } from "./Button";
import ResetIcon from "../icons/ResetIcon";

interface ResetButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "danger" | "ghost";
}

export const ResetButton: React.FC<ResetButtonProps> = React.memo(
  ({ onClick, disabled = false, className = "", ariaLabel, children, size = "sm", variant = "ghost" }) => (
    <Button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      size={size}
      variant={variant}
      className={`p-1 rounded border border-transparent transition-all duration-150 ${
        disabled
          ? "opacity-50 cursor-not-allowed text-text/40"
          : "hover:bg-logo-primary/30 active:bg-logo-primary/50 active:translate-y-[1px] hover:cursor-pointer hover:border-logo-primary text-text/80"
      } ${className}`}
    >
      {children ?? <ResetIcon />}
    </Button>
  ),
);
