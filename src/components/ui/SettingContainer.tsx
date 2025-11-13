import { Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";
import { TooltipIcon } from "./TooltipIcon";

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
  const containerClass =
    layout === "horizontal"
      ? "flex-row justify-between! items-center"
      : "flex-col";

  return (
    <Flex py="2" px="3" gap="2" className={containerClass} aria-disabled={disabled}>
      {/* 左侧标题和说明 */}
      <Flex align="center" gap="2">
        <Heading
          as="h2"
          size="3"
          weight="medium"
          className={disabled ? "opacity-40" : ""}
        >
          {title}
        </Heading>
        {descriptionMode === "tooltip" ? (
          <TooltipIcon
            text={title}
            description={description}
            tooltipPosition={tooltipPosition}
          />
        ) : (
          <Text as="p" size="2" className={disabled ? "opacity-20" : "opacity-30"}>
            {description}
          </Text>
        )}
      </Flex>

      {/* 右侧内容区域 - 操作按钮和子内容都在同一行 */}
      {children}
    </Flex>
  );
};
