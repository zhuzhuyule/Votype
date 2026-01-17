import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  IconCircleCheck,
  IconGripVertical,
  IconLock,
} from "@tabler/icons-react";
import React from "react";
import { DynamicIcon } from "../../shared/IconPicker";

export interface SidebarItemProps {
  option: { value: string; label: string };
  isSelected: boolean;
  isActive?: boolean;
  isBuiltin?: boolean;
  isVerified?: boolean;
  onClick: () => void;
  onActivate: () => void;
  t: any;
  icon?: string;
  outputMode?: "polish" | "chat" | "silent";
  aliases?: string | null;
  /** Enable drag-and-drop when true */
  sortable?: boolean;
  /** Unique ID for sortable context */
  id?: string;
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
  aliases: aliasStr,
  sortable = false,
  id,
}) => {
  // 解析别名列表
  const aliases = React.useMemo(() => {
    if (!aliasStr) return [];
    return aliasStr
      .split(/[,，]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }, [aliasStr]);

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
        group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm select-none
        transition-colors duration-200
        ${
          isSelected
            ? "bg-(--accent-a3) text-(--accent-11) font-medium"
            : "text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
        }
        ${isDragging ? "shadow-lg bg-white dark:bg-gray-900" : ""}
      `}
    >
      <Flex align="start" gap="2" className="flex-1 min-w-0">
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
        {icon && (
          <Box className="shrink-0 text-gray-400 group-hover:text-(--accent-11) mt-0.5">
            <DynamicIcon name={icon} size={16} />
          </Box>
        )}
        <Flex direction="column" gap="0" className="flex-1 min-w-0">
          {/* 标题行 */}
          <Flex align="center" gap="2" className="min-w-0">
            <Text size="2" className="font-medium truncate">
              {option.label}
            </Text>
            {outputMode === "chat" && (
              <span className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 font-medium leading-none">
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
          {/* 别名行（副标题）- 仅当有别名时显示 */}
          {aliases.length > 0 && (
            <Flex gap="1" wrap="wrap" className="min-w-0 mt-0.5">
              {aliases.map((a, idx) => (
                <span
                  key={idx}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 leading-none truncate max-w-20"
                  title={a}
                >
                  {a}
                </span>
              ))}
            </Flex>
          )}
        </Flex>
      </Flex>

      <Flex align="center" gap="2" className="shrink-0">
        {isActive && (
          <Box className="bg-(--accent-a3) text-(--accent-11) px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider leading-none">
            {t("common.default")}
          </Box>
        )}
        {isBuiltin && (
          <Box title={t("settings.postProcessing.api.provider.builtinTooltip")}>
            <IconLock size={14} style={{ opacity: 0.5 }} />
          </Box>
        )}
      </Flex>
    </div>
  );
};
