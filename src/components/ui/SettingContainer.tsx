import React from "react";
import { TooltipIcon } from './TooltipIcon';

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

// Layout configurations
const layoutConfig = {
  horizontal: {
    containerLayout: "flex items-center justify-between",
    titleContainer: "max-w-[66.666667%] flex items-center gap-2",
    contentContainer: "relative flex-1 max-w-[33.333333%]"
  },
  stacked: {
    containerLayout: "",
    titleContainer: "flex items-center gap-2",
    contentContainer: "w-full"
  }
} as const;

// Description mode configurations  
const descriptionModeConfig = {
  tooltip: {
    inlineDescription: false,
    renderTooltip: true
  },
  inline: {
    inlineDescription: true,
    renderTooltip: false
  }
} as const;

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
  const baseContainerClasses = "px-4 py-2";
  const borderClasses = grouped ? "" : "rounded-lg border border-mid-gray/20";
  const layoutClasses = layoutConfig[layout].containerLayout;

  const containerClasses = `${baseContainerClasses} ${borderClasses} ${layoutClasses}`.trim();
  const titleClasses = `text-sm font-medium ${disabled ? "opacity-50" : ""}`;

  const renderTitle = (className: string = "") => (
    <h3 className={`${titleClasses} ${className}`}>
      {title}
    </h3>
  );


  // Get current configuration
  const currentLayoutConfig = layoutConfig[layout];
  const currentDescriptionConfig = descriptionModeConfig[descriptionMode];

  // Generate title content based on description mode
  const titleContent = currentDescriptionConfig.renderTooltip ? (
    <div className={currentLayoutConfig.titleContainer}>
      {renderTitle()}
      <TooltipIcon text={title} description={description} tooltipPosition={tooltipPosition} />
    </div>
  ) : (
    <div className={currentLayoutConfig.titleContainer}>
      {renderTitle()}
      <p className={`text-sm mt-1 ${disabled ? "opacity-50" : ""}`}>
        {description}
      </p>
    </div>
  );

  // Generate header content based on layout
  const headerContent = layout === "stacked" ? (
    <div className="flex items-center mb-2 justify-between">
      {titleContent}
      {actions && <div className="flex items-center">{actions}</div>}
    </div>
  ) : (
    titleContent
  );

  // Generate content container
  const contentContainer = (
    <div className={currentLayoutConfig.contentContainer}>
      {children}
    </div>
  );

  return (
    <div className={containerClasses}>
      {headerContent}
      {contentContainer}
    </div>
  );
};
