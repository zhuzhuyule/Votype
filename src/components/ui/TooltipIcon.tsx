import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { IconButton, Text, Box } from "@radix-ui/themes";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";

interface TooltipIconProps {
  text: string;
  description: string;
  tooltipPosition?: "top" | "bottom";
  className?: string;
}

export const TooltipIcon: React.FC<TooltipIconProps> = React.memo(({ 
  text, 
  description, 
  tooltipPosition = "top", 
  className = "" 
}) => (
  <Tooltip.Provider delayDuration={200}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          className={`w-4 h-4 p-0 text-mid-gray hover:text-logo-primary transition-colors duration-200 focus:ring-2 focus:ring-logo-primary focus:ring-offset-1 rounded ${className}`}
          aria-label={`${text}: ${description}`}
        >
          <QuestionMarkCircledIcon width="16" height="16" />
        </IconButton>
      </Tooltip.Trigger>
      <Tooltip.Content
        side={tooltipPosition}
        className="animate-in fade-in-0 zoom-in-95 duration-200"
        sideOffset={8}
      >
        <Box className="px-3 py-2 bg-background border border-mid-gray/80 rounded-lg shadow-lg max-w-xs min-w-[200px] whitespace-normal z-50">
          <Text size="2" align="center" className="leading-relaxed">
            {description}
          </Text>
        </Box>
        <Tooltip.Arrow className="fill-mid-gray/80" />
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
));
