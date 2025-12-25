import { Box, Flex, Text } from "@radix-ui/themes";
import { IconCircleCheck, IconLock } from "@tabler/icons-react";
import React from "react";

export interface SidebarItemProps {
  option: { value: string; label: string };
  isSelected: boolean;
  isActive?: boolean;
  isBuiltin: boolean;
  isVerified?: boolean;
  onClick: () => void;
  onActivate: () => void;
  t: any;
}

export const SidebarItem: React.FC<SidebarItemProps> = ({
  option,
  isSelected,
  isActive,
  isBuiltin,
  isVerified,
  onClick,
  onActivate,
  t,
}) => {
  return (
    <div
      onClick={onClick}
      className={`
        group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm select-none
        transition-colors duration-200
        ${
          isSelected
            ? "bg-(--accent-a3) text-(--accent-11) font-medium"
            : "text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
        }
      `}
    >
      <Flex align="center" gap="3" className="flex-1 truncate">
        {/* Active Indicator / Radio */}
        <div
          className="shrink-0 p-0.5 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
          }}
          title={isActive ? t("common.active") : t("common.useThisProvider")}
        >
          <div
            className={`
              w-3 h-3 rounded-full border transition-all duration-200
              ${
                isActive
                  ? "bg-green-500 border-green-500 shadow-sm"
                  : "border-gray-300 dark:border-gray-600 group-hover:border-gray-400"
              }
            `}
          />
        </div>
        <Text size="2" className="font-medium">
          {option.label}
        </Text>
        {isVerified && (
          <IconCircleCheck size={14} className="text-green-500 shrink-0" />
        )}
      </Flex>
      {isBuiltin && (
        <Box title={t("settings.postProcessing.api.provider.builtinTooltip")}>
          <IconLock size={14} style={{ opacity: 0.5 }} />
        </Box>
      )}
    </div>
  );
};
