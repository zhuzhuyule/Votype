import { Box, Flex, Text } from "@radix-ui/themes";
import { IconCircleCheck, IconLock } from "@tabler/icons-react";
import React from "react";
import { DynamicIcon } from "../../shared/IconPicker";

export interface SidebarItemProps {
  option: { value: string; label: string };
  isSelected: boolean;
  isActive?: boolean;
  isBuiltin: boolean;
  isVerified?: boolean;
  onClick: () => void;
  onActivate: () => void;
  t: any;
  icon?: string;
  outputMode?: "refinement" | "generation";
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
  icon,
  outputMode,
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
      <Flex align="center" gap="2" className="flex-1 truncate">
        {icon && (
          <Box className="shrink-0 text-gray-400 group-hover:text-(--accent-11)">
            <DynamicIcon name={icon} size={16} />
          </Box>
        )}
        <Text size="2" className="font-medium truncate">
          {option.label}
        </Text>
        {outputMode === "generation" && (
          <span className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 font-medium leading-none">
            生成
          </span>
        )}
        {isActive && (
          <Box className="shrink-0 bg-(--accent-a3) text-(--accent-11) px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider leading-none">
            {t("common.default")}
          </Box>
        )}
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
