import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";
import { TooltipIcon } from "./TooltipIcon";

export interface SettingContainerProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked";
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
  actions?: React.ReactNode;
  icon?: React.ElementType; // Icon prop
}

export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  descriptionMode = "tooltip",
  layout = "horizontal",
  disabled = false,
  tooltipPosition = "top",
  icon: Icon,
}) => {
  const isHorizontal = layout === "horizontal";

  return (
    <Flex
      py="2"
      px="0"
      align={isHorizontal ? "center" : "stretch"}
      justify="between"
      direction={isHorizontal ? "row" : "column"}
      gap="4"
      style={{
        width: "100%",
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      <Flex gap="3" align="center" style={{ flex: 1, minWidth: 0 }}>
        {Icon && (
          <Box style={{ color: "var(--gray-10)", flexShrink: 0 }}>
            <Icon size={20} />
          </Box>
        )}
        <Box>
          <Flex align="center" gap="2">
            <Heading size="2" weight="medium" style={{ lineHeight: "1.5" }}>
              {title}
            </Heading>
            {descriptionMode === "tooltip" && description && (
              <TooltipIcon
                text={title}
                description={description}
                tooltipPosition={tooltipPosition}
              />
            )}
          </Flex>
          {descriptionMode !== "tooltip" && description && (
            <Text
              size="2"
              color="gray"
              style={{ lineHeight: "1.4", display: "block", marginTop: "2px" }}
            >
              {description}
            </Text>
          )}
        </Box>
      </Flex>

      <Box style={{ flexShrink: 0 }}>{children}</Box>
    </Flex>
  );
};
