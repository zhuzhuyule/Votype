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
      className={`group p-1.5 rounded-md border border-transparent transition-all duration-200 ease-in-out focus:outline-none ${
        disabled
          ? "opacity-50 cursor-not-allowed text-text/40"
          : "hover:bg-logo-primary/20 active:scale-95 active:bg-logo-primary/30 hover:cursor-pointer hover:border-logo-primary/50 text-text/80 hover:text-logo-primary focus:ring-2 focus:ring-logo-primary/30 focus:border-logo-primary"
      } ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="block transition-transform duration-200 group-hover:rotate-180 group-active:rotate-180">
        {children ?? <ResetIcon />}
      </span>
    </button>
  ),
);
