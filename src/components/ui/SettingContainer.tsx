import * as Tooltip from "@radix-ui/react-tooltip";
import { HelpCircle } from "lucide-react";
import React from "react";

interface SettingContainerProps {
  title: string;
  description: string;
  children: React.ReactNode;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked";
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
  actions?: React.ReactNode;
}

const tooltipContentClasses = "px-3 py-2 bg-background border border-mid-gray/80 rounded-lg shadow-lg max-w-xs min-w-[200px] whitespace-normal z-50";

const TooltipWrapper: React.FC<{
  description: string;
  tooltipPosition: "top" | "bottom";
  children: React.ReactNode;
}> = ({ description, tooltipPosition, children }) => (
  <Tooltip.Provider delayDuration={200}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        {children}
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
);

export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  descriptionMode = "tooltip",
  grouped = false,
  layout = "horizontal",
  disabled = false,
  tooltipPosition = "top",
  actions,
}) => {
  const containerClasses = grouped
    ? "px-4 py-2"
    : "px-4 py-2 rounded-lg border border-mid-gray/20";

  const horizontalContainerClasses = grouped
    ? "flex items-center justify-between px-4 py-2"
    : "flex items-center justify-between px-4 py-2 rounded-lg border border-mid-gray/20";

  const titleClasses = `text-sm font-medium ${disabled ? "opacity-50" : ""}`;

  const renderTitle = (className: string = "") => (
    <h3 className={`${titleClasses} ${className}`}>
      {title}
    </h3>
  );

  const renderTooltipIcon = () => (
    <TooltipWrapper description={description} tooltipPosition={tooltipPosition}>
      <span
        className="w-4 h-4 p-0 text-mid-gray hover:text-logo-primary transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-logo-primary focus:ring-offset-1 rounded"
        aria-label="More information"
      >
        <HelpCircle className="w-4 h-4" />
      </span>
    </TooltipWrapper>
  );

  // Stacked layout
  if (layout === "stacked") {
    if (descriptionMode === "tooltip") {
      return (
        <div className={containerClasses}>
          <div className="flex items-center mb-2 justify-between">
            <div className="flex items-center gap-2">
              {renderTitle()}
              {renderTooltipIcon()}
            </div>
            {actions && <div className="flex items-center">{actions}</div>}
          </div>
          <div className="w-full">{children}</div>
        </div>
      );
    }

    return (
      <div className={containerClasses}>
        <div className="mb-2">
          {renderTitle()}
          <p className={`text-sm mt-1 ${disabled ? "opacity-50" : ""}`}>
            {description}
          </p>
        </div>
        <div className="w-full">{children}</div>
      </div>
    );
  }

  // Horizontal layout (default)
  if (descriptionMode === "tooltip") {
    return (
      <div className={horizontalContainerClasses}>
        <div className="max-w-[66.666667%] flex items-center gap-2">
          {renderTitle()}
          {renderTooltipIcon()}
        </div>
        <div className="relative flex-1 max-w-[33.333333%]">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={horizontalContainerClasses}>
      <div className="max-w-[66.666667%]">
        {renderTitle()}
        <p className={`text-sm mt-1 ${disabled ? "opacity-50" : ""}`}>
          {description}
        </p>
      </div>
      <div className="relative flex-1 max-w-[33.333333%]">
        {children}
      </div>
    </div>
  );
};
