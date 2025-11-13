import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Flex, Text, Box, IconButton } from "@radix-ui/themes";
import { CopyIcon, CheckIcon } from "@radix-ui/react-icons";
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

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <Flex align="center" gap="2">
        <Box flexGrow="1" minWidth="0">
          <Box
            px="2"
            minHeight="32px"
            className={`flex items-center bg-mid-gray/10 border border-mid-gray/80 rounded text-xs ${
              monospace ? "font-mono break-all" : "break-words"
            } ${!value ? "opacity-60" : ""}`}
          >
            <Text
              size="1"
              className={monospace ? "font-mono" : ""}
              color={!value ? "gray" : undefined}
            >
              {displayValue}
            </Text>
          </Box>
        </Box>
        {copyable && value && (
          <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
            <Popover.Trigger asChild>
              <IconButton
                size="1"
                variant="surface"
                color="gray"
                onClick={handleCopy}
                className="w-12 min-h-8 hover:bg-logo-primary/10 hover:border-logo-primary hover:text-logo-primary transition-all duration-150 flex-shrink-0 cursor-pointer"
                title="Copy to clipboard"
              >
                {showCopied ? (
                  <CheckIcon width="16" height="16" className="text-green-500" />
                ) : (
                  <CopyIcon width="16" height="16" />
                )}
              </IconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="bg-green-500 text-white px-3 py-2 rounded-md text-sm shadow-lg z-50"
                side="top"
                align="center"
              >
                <Text size="2" color="white">
                  Copied!
                </Text>
                <Popover.Arrow className="fill-green-500" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </Flex>
    </SettingContainer>
  );
};
