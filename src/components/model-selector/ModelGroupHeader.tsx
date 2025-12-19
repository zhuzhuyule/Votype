import { Box, Flex, Text } from "@radix-ui/themes";
import React from "react";

interface ModelGroupHeaderProps {
  icon: React.ReactNode;
  label: string;
  count: number | string;
  className?: string;
}

export const ModelGroupHeader: React.FC<ModelGroupHeaderProps> = ({
  icon,
  label,
  count,
  className,
}) => {
  return (
    <Box
      className={`px-4 py-1.5 flex justify-between items-center select-none ${
        className || "text-text/70 bg-mid-gray/5"
      }`}
    >
      <Flex align="center" gap="2" className="min-w-0 flex-1 mr-3">
        <Box className="flex-shrink-0 text-current">{icon}</Box>
        <Text
          className="truncate font-bold uppercase tracking-wider text-[11px]"
          weight="bold"
        >
          {label}
        </Text>
        <span
          style={{ borderRadius: "var(--radius-3)" }}
          className="opacity-80 text-[10px] bg-background/50 px-1.5 border border-black/5 flex-shrink-0 font-medium"
        >
          {count}
        </span>
      </Flex>
    </Box>
  );
};
