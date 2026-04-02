import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Flex, Text } from "@radix-ui/themes";
import { IconCircleCheck, IconGripVertical } from "@tabler/icons-react";
import React from "react";
import { DynamicIcon } from "../../shared/IconPicker";

export interface SidebarItemProps {
  option: { value: string; label: string | React.ReactNode };
  isActive?: boolean;
  isSelected: boolean;
  isLocked?: boolean;
  isVerified?: boolean;
  onClick: () => void;
  onActivate: () => void;
  t: any;
  icon?: string;
  iconNode?: React.ReactNode;
  outputMode?: "polish" | "chat" | "silent";
  /** Enable drag-and-drop when true */
  sortable?: boolean;
  /** Unique ID for sortable context */
  id?: string;
}

export const SidebarItem: React.FC<SidebarItemProps> = ({
  option,
  isSelected,
  isLocked,
  isVerified,
  onClick,
  onActivate,
  t,
  icon,
  iconNode,
  outputMode,
  sortable = false,
  id,
}) => {
  // Sortable setup (only active when sortable prop is true)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: id || option.value,
    disabled: !sortable,
  });

  const style: React.CSSProperties = sortable
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : undefined,
      }
    : {};

  return (
    <div
      ref={sortable ? setNodeRef : undefined}
      style={style}
      onClick={onClick}
      className={`
        group relative flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm select-none
        transition-all duration-150
        ${
          isSelected
            ? "bg-(--accent-a3) text-(--accent-11) font-medium"
            : "text-gray-600 hover:bg-(--gray-a3) dark:hover:bg-(--gray-a3)"
        }
        ${isDragging ? "shadow-lg bg-white dark:bg-gray-900" : ""}
      `}
    >
      {/* Active indicator bar */}
      {isSelected && (
        <Box className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-(--accent-9)" />
      )}
      <Flex align="center" gap="2" className="flex-1 min-w-0">
        {/* Drag handle - only visible when sortable */}
        {sortable && (
          <Box
            {...attributes}
            {...listeners}
            className="shrink-0 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <IconGripVertical size={14} />
          </Box>
        )}
        {iconNode ? (
          <Box className="shrink-0 mt-0.5">{iconNode}</Box>
        ) : icon ? (
          <Box
            className={`shrink-0 mt-0.5 ${isSelected ? "text-(--accent-9)" : "text-gray-400 group-hover:text-(--accent-11)"}`}
          >
            <DynamicIcon name={icon} size={16} />
          </Box>
        ) : null}
        <Flex direction="column" gap="0" className="flex-1 min-w-0">
          {/* 标题行 */}
          <Flex align="center" gap="2" className="min-w-0">
            <Text size="2" className="font-medium truncate">
              {option.label}
            </Text>
            {outputMode === "chat" && (
              <span className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-(--accent-a3) text-(--accent-11) font-medium leading-none">
                {t(
                  "settings.postProcessing.prompts.outputMode.chat",
                  "AI Chat",
                )}
              </span>
            )}

            {isVerified && (
              <IconCircleCheck size={14} className="text-green-500 shrink-0" />
            )}
          </Flex>
        </Flex>
      </Flex>
      <Flex align="center" gap="2" className="shrink-0" />
    </div>
  );
};
