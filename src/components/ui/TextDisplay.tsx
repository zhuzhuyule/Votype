import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { SettingContainer } from "./SettingContainer";

interface TextDisplayProps {
  label: string;
  description: string;
  value: string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  placeholder?: string;
  copyable?: boolean;
  monospace?: boolean;
  onCopy?: (value: string) => void;
}

export const TextDisplay: React.FC<TextDisplayProps> = ({
  label,
  description,
  value,
  descriptionMode = "tooltip",
  grouped = false,
  placeholder = "Not available",
  copyable = false,
  monospace = false,
  onCopy,
}) => {
  const [showCopied, setShowCopied] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleCopy = async () => {
    if (!value || !copyable) return;

    try {
      await navigator.clipboard.writeText(value);
      setShowCopied(true);
      setPopoverOpen(true);
      setTimeout(() => {
        setShowCopied(false);
        setPopoverOpen(false);
      }, 1500);
      if (onCopy) {
        onCopy(value);
      }
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  const displayValue = value || placeholder;
  const textClasses = monospace ? "font-mono break-all" : "break-words";

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="flex items-center space-x-2">
        <div className="flex-1 min-w-0">
          <div
            className={`px-2 min-h-8 flex items-center bg-mid-gray/10 border border-mid-gray/80 rounded text-xs ${textClasses} ${!value ? "opacity-60" : ""}`}
          >
            {displayValue}
          </div>
        </div>
        {copyable && value && (
          <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
            <Popover.Trigger asChild>
              <button
                onClick={handleCopy}
                className="flex items-center justify-center px-2 py-1 w-12 min-h-8 text-xs font-semibold bg-mid-gray/10 hover:bg-logo-primary/10 border border-mid-gray/80 hover:border-logo-primary hover:text-logo-primary rounded transition-all duration-150 flex-shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-logo-primary"
                title="Copy to clipboard"
              >
                {showCopied ? (
                  <svg
                    className="w-4 h-4 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="bg-green-500 text-white px-3 py-2 rounded-md text-sm shadow-lg z-50"
                side="top"
                align="center"
              >
                Copied!
                <Popover.Arrow className="fill-green-500" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>
    </SettingContainer>
  );
};
