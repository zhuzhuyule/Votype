import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

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
    ? "px-4 p-2"
    : "px-4 p-2 rounded-lg border border-mid-gray/20";

  const horizontalContainerClasses = grouped
    ? "flex items-center justify-between px-4 p-2"
    : "flex items-center justify-between px-4 p-2 rounded-lg border border-mid-gray/20";

  const renderTitle = (className: string) => (
    <h3 className={`text-sm font-medium ${disabled ? "opacity-50" : ""} ${className}`}>
      {title}
    </h3>
  );

  const renderTooltipContent = () => (
    <div className="px-3 py-2 bg-background border border-mid-gray/80 rounded-lg shadow-lg max-w-xs min-w-[200px] whitespace-normal">
      <p className="text-sm text-center leading-relaxed">{description}</p>
    </div>
  );

  if (layout === "stacked") {
    if (descriptionMode === "tooltip") {
      return (
        <div className={containerClasses}>
          <div className="flex items-center mb-2 justify-between">
            <div className="flex items-center gap-2">
              {renderTitle("")}
              <Tooltip.Provider delayDuration={200}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      className="w-4 h-4 text-mid-gray cursor-help hover:text-logo-primary transition-colors duration-200 select-none focus:outline-none focus:ring-2 focus:ring-logo-primary focus:ring-offset-1 rounded"
                      aria-label="More information"
                    >
                      <svg
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        className="w-full h-full"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    side={tooltipPosition === "top" ? "top" : "bottom"}
                    className="animate-in fade-in-0 zoom-in-95 duration-200"
                    sideOffset={8}
                  >
                    {renderTooltipContent()}
                    <Tooltip.Arrow className="fill-mid-gray/80" />
                  </Tooltip.Content>
                </Tooltip.Root>
              </Tooltip.Provider>
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
          {renderTitle("")}
          <p className={`text-sm ${disabled ? "opacity-50" : ""}`}>
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
        <div className="max-w-2/3">
          <div className="flex items-center gap-2">
            {renderTitle("")}
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    className="w-4 h-4 text-mid-gray cursor-help hover:text-logo-primary transition-colors duration-200 select-none focus:outline-none focus:ring-2 focus:ring-logo-primary focus:ring-offset-1 rounded"
                    aria-label="More information"
                  >
                    <svg
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      className="w-full h-full"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content
                  side={tooltipPosition === "top" ? "top" : "bottom"}
                  className="animate-in fade-in-0 zoom-in-95 duration-200"
                  sideOffset={8}
                >
                  {renderTooltipContent()}
                  <Tooltip.Arrow className="fill-mid-gray/80" />
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>
        </div>
        <div className="relative">{children}</div>
      </div>
    );
  }

  return (
    <div className={horizontalContainerClasses}>
      <div className="max-w-2/3">
        {renderTitle("")}
        <p className={`text-sm ${disabled ? "opacity-50" : ""}`}>
          {description}
        </p>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
};
