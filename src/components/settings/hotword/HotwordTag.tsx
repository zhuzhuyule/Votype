// HotwordTag - Single clickable/draggable tag for a hotword

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Tooltip } from "@radix-ui/themes";
import React from "react";
import type { Hotword, HotwordCategoryMeta } from "../../../types/hotword";
import { SOURCE_LABELS } from "../../../types/hotword";

interface HotwordTagProps {
  hotword: Hotword;
  isSelected: boolean;
  isHighlighted?: boolean;
  onClick: () => void;
  categoryMap: Record<string, HotwordCategoryMeta>;
}

export const HotwordTag: React.FC<HotwordTagProps> = ({
  hotword,
  isSelected,
  isHighlighted,
  onClick,
  categoryMap,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `hotword-${hotword.id}`,
      data: { hotword },
    });

  const color = (categoryMap[hotword.category]?.color ?? "gray") as
    | "green"
    | "orange"
    | "blue"
    | "purple"
    | "gray"
    | "red"
    | "cyan"
    | "amber"
    | "teal"
    | "pink";
  const tooltipContent = [
    hotword.originals.length > 0 && `纠错: ${hotword.originals.length}`,
    `使用: ${hotword.use_count}次`,
    hotword.source !== "manual" && SOURCE_LABELS[hotword.source],
  ]
    .filter(Boolean)
    .join(" | ");

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : undefined,
  };

  return (
    <Tooltip content={tooltipContent}>
      <Badge
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        size="2"
        variant={isHighlighted ? "solid" : isSelected ? "solid" : "soft"}
        color={color}
        style={style}
        className={`px-3 py-1.5 cursor-pointer select-none ${
          isDragging
            ? "shadow-lg scale-105"
            : isHighlighted
              ? "animate-highlight-fade ring-2 ring-offset-1 ring-current"
              : isSelected
                ? "ring-2 ring-offset-1 ring-current transition-all duration-150"
                : "hover:brightness-95 active:scale-95 transition-all duration-150"
        }`}
        onClick={onClick}
      >
        {hotword.target}
      </Badge>
    </Tooltip>
  );
};
