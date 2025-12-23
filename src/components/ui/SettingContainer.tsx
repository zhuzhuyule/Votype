import { Box, Flex, Text } from "@radix-ui/themes";
import React from "react";
import { useCompactModeSafe } from "../theme/CompactModeProvider";
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
  const compactMode = useCompactModeSafe();

  // When compact mode is enabled, force tooltip mode
  const effectiveDescriptionMode = compactMode ? "tooltip" : descriptionMode;

  return (
    <Flex
      py="2"
      px="0"
      align="center"
      justify="between"
      direction="row"
      gap="4"
      style={{
        width: "100%",
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
        minHeight: "44px", // Ensure consistent height for rows
      }}
    >
      <Flex gap="3" align="center" style={{ flex: 1, minWidth: 0 }}>
        {Icon && (
          <Box style={{ color: "var(--gray-10)", flexShrink: 0 }}>
            <Icon size={20} />
          </Box>
        )}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Flex align="center" gap="2">
            <Text
              size="2"
              weight="medium"
              style={{
                lineHeight: "1.5",
                color: "var(--gray-12)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </Text>
            {effectiveDescriptionMode === "tooltip" && description && (
              <TooltipIcon
                text={title}
                description={description}
                tooltipPosition={tooltipPosition}
              />
            )}
          </Flex>
          {effectiveDescriptionMode !== "tooltip" && description && (
            <Text
              size="1"
              color="gray"
              style={{
                lineHeight: "1.4",
                display: "block",
                marginTop: "1px",
              }}
            >
              {description}
            </Text>
          )}
        </Box>
      </Flex>

      <Box style={{ flexShrink: 0, marginLeft: "auto" }}>{children}</Box>
    </Flex>
  );
};
