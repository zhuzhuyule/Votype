import React from "react";
import { IconButton, Text, Tooltip } from "@radix-ui/themes";
import { HelpCircle } from "lucide-react";

interface TooltipIconProps {
  text: string;
  description: string;
  tooltipPosition?: "top" | "bottom";
  className?: string;
}

export const TooltipIcon: React.FC<TooltipIconProps> = React.memo(
  ({
    text,
    description,
    tooltipPosition = "top",
    className = "",
  }) => (
    <Tooltip
      content={
        <Text size="2" className="leading-relaxed text-center">
          {description}
        </Text>
      }
      delayDuration={200}
      side={tooltipPosition}
      sideOffset={8}
    >
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        className={`w-4 h-4 p-0 text-mid-gray hover:text-logo-primary transition-colors duration-200 focus:ring-2 focus:ring-logo-primary focus:ring-offset-1 rounded ${className}`}
        aria-label={`${text}: ${description}`}
      >
        <HelpCircle width={16} height={16} />
      </IconButton>
    </Tooltip>
  ),
);
