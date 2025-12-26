// TagInput - Reusable tag input component for aliases and prefixes

import { Badge, Flex, Text, TextField } from "@radix-ui/themes";
import { IconPlus, IconX } from "@tabler/icons-react";
import React, { useRef, useState } from "react";

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
  error?: string | null;
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
  error,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePlaceholderClick = () => {
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      onAdd();
    }
    setIsEditing(false);
  };

  const handleKeyDownInternal = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputValue.trim()) {
        onAdd();
      }
      // Keep editing mode open for adding more
    } else if (e.key === "Escape") {
      setIsEditing(false);
      onInputChange("");
    }
    onKeyDown(e);
  };

  return (
    <Flex direction="column" gap="1">
      <Flex wrap="wrap" gap="2" align="center">
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

        {/* Inline editable placeholder tag */}
        {isEditing ? (
          <TextField.Root
            ref={inputRef}
            variant="soft"
            size="1"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDownInternal}
            onBlur={handleBlur}
            placeholder={placeholder}
            className="min-w-[100px] max-w-[150px]"
          />
        ) : (
          <Badge
            size="2"
            variant="outline"
            color="gray"
            className="px-2 py-1 gap-1 cursor-pointer opacity-50 hover:opacity-100 transition-opacity border-dashed"
            onClick={handlePlaceholderClick}
          >
            <IconPlus size={12} />
            {tags.length === 0 ? emptyMessage : ""}
          </Badge>
        )}
      </Flex>

      {error && (
        <Text size="1" color="red">
          {error}
        </Text>
      )}
    </Flex>
  );
};
