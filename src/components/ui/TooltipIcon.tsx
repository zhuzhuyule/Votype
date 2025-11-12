import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { HelpCircle } from 'lucide-react';

interface TooltipIconProps {
  text: string;
  description: string;
  tooltipPosition?: "top" | "bottom";
  className?: string;
}

const tooltipContentClasses = "px-3 py-2 bg-background border border-mid-gray/80 rounded-lg shadow-lg max-w-xs min-w-[200px] whitespace-normal z-50";

export const TooltipIcon: React.FC<TooltipIconProps> = React.memo(({ 
  text, 
  description, 
  tooltipPosition = "top", 
  className = "" 
}) => (
  <Tooltip.Provider delayDuration={200}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={`w-4 h-4 p-0 text-mid-gray hover:text-logo-primary transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-logo-primary focus:ring-offset-1 rounded ${className}`}
          aria-label={`${text}: ${description}`}
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content
        side={tooltipPosition}
        className="animate-in fade-in-0 zoom-in-95 duration-200"
        sideOffset={8}
      >
        <div className={tooltipContentClasses}>
          <p className="text-sm text-center leading-relaxed">{description}</p>
        </div>
        <Tooltip.Arrow className="fill-mid-gray/80" />
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
));