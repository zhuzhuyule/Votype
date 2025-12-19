// TagInput - Reusable tag input component for aliases and prefixes

import { Badge, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { IconPlus, IconX } from "@tabler/icons-react";
import React from "react";

interface TagInputProps {
  tags: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  emptyMessage: string;
  color?: "indigo" | "orange" | "blue" | "gray";
}

export const TagInput: React.FC<TagInputProps> = ({
  tags,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  onKeyDown,
  placeholder,
  emptyMessage,
  color = "indigo",
}) => {
  return (
    <Flex gap="2" align="center" wrap="wrap">
      <Flex gap="2" className="flex-shrink-0">
        <TextField.Root
          variant="surface"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="flex-1 min-w-[150px]"
        />
        <IconButton
          variant="soft"
          color="gray"
          onClick={onAdd}
          disabled={!inputValue.trim()}
        >
          <IconPlus size={16} />
        </IconButton>
      </Flex>

      <Flex wrap="wrap" gap="2" align="center" className="flex-1">
        {tags.map((tag, i) => (
          <Badge
            key={i}
            size="2"
            variant="soft"
            color={color}
            className="px-2 py-1 gap-1 cursor-default"
          >
            {tag}
            <IconX
              size={13}
              className="cursor-pointer hover:text-red-600 opacity-60 hover:opacity-100 transition-opacity"
              onClick={() => onRemove(tag)}
            />
          </Badge>
        ))}
        {tags.length === 0 && (
          <Text size="1" color="gray" className="italic opacity-70">
            {emptyMessage}
          </Text>
        )}
      </Flex>
    </Flex>
  );
};
