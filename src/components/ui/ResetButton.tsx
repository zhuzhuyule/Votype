import React from "react";
import ResetIcon from "../icons/ResetIcon";

interface ResetButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}

export const ResetButton: React.FC<ResetButtonProps> = React.memo(
  ({ onClick, disabled = false, className = "", ariaLabel, children }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`p-1.5 rounded-md border border-transparent transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-logo-primary/40 ${
        disabled
          ? "opacity-50 cursor-not-allowed text-text/40"
          : "hover:bg-mid-gray/10 active:bg-mid-gray/15 hover:cursor-pointer text-text/70 hover:text-text/90"
      } ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children ?? <ResetIcon />}
    </button>
  ),
);
