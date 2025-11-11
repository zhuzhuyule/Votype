import React from "react";
import { Button } from "../ui/Button";

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface ModelStatusButtonProps {
  status: ModelStatus;
  displayText: string;
  isDropdownOpen: boolean;
  onClick: () => void;
  className?: string;
  modeLabel?: string;
  modeLabelColor?: string;
  isOnlineModel?: boolean;
}

const ModelStatusButton: React.FC<ModelStatusButtonProps> = ({
  status,
  displayText,
  isDropdownOpen,
  onClick,
  className = "",
  modeLabelColor,
  modeLabel,
  isOnlineModel = false,
}) => {
  const getStatusColor = (status: ModelStatus): string => {
    if (isOnlineModel) {
      return "bg-blue-500";
    }
    switch (status) {
      case "ready":
        return "bg-green-400";
      case "loading":
        return "bg-yellow-400 animate-pulse";
      case "downloading":
        return "bg-logo-primary animate-pulse";
      case "extracting":
        return "bg-orange-400 animate-pulse";
      case "error":
        return "bg-red-400";
      case "unloaded":
        return "bg-mid-gray/60";
      case "none":
        return "bg-red-400";
      default:
        return "bg-mid-gray/60";
    }
  };

  return (
    <Button
      onClick={onClick}
      variant="ghost"
      size="sm"
      className={`flex items-center gap-2 hover:text-text/80 transition-colors ${className}`}
      title={`Model status: ${displayText}`}
    >
      {modeLabel && (
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full transition ${
            modeLabelColor ?? "text-mid-gray/60 border border-mid-gray/30"
          }`}
        >
          {modeLabel}
        </span>
      )}
      <div className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
      <span>{displayText}</span>
      <svg
        className={`w-3 h-3 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </Button>
  );
};

export default ModelStatusButton;
