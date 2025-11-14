import React from "react";
import { Button } from "./Button";

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
  ({
    onClick,
    disabled = false,
    ariaLabel,
    children,
    size = "sm",
    variant = "ghost",
  }) => (
    
  ),
);
