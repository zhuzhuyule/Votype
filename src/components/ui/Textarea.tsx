import React from "react";
import { Text, TextArea, Box } from "@radix-ui/themes";

interface TextareaProps
  extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "defaultValue"
  > {
  value?: string;
  variant?: "default" | "compact";
  label?: string;
  error?: string;
  description?: string;
  showCharCount?: boolean;
  resize?: "none" | "both" | "horizontal" | "vertical";
  defaultValue?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  label,
  error,
  description,
  showCharCount = false,
  id,
  value,
  defaultValue,
  resize = "vertical",
  style,
  maxLength,
  color,
  ...rest
}) => {
  const textareaId =
    id || `textarea-${Math.random().toString(36).substr(2, 9)}`;

  const getSize = () => {
    switch (variant) {
      case "compact":
        return "1";
      default:
        return "2";
    }
  };

  const getMinHeight = () => {
    switch (variant) {
      case "compact":
        return "80px";
      default:
        return "100px";
    }
  };

  const textareaElement = (
    <Box className="relative">
      <TextArea
        id={textareaId}
        size={getSize()}
        className={`${className} ${error ? "border border-red-400" : ""}`}
        style={{
          minHeight: getMinHeight(),
          resize,
          ...(style || {}),
        }}
        value={value}
        defaultValue={defaultValue}
        maxLength={maxLength}
        {...rest}
      />
      {showCharCount && maxLength && (
        <Text
          className="absolute bottom-2 right-2 text-xs text-text/60 bg-background px-1 rounded"
          size="1"
        >
          {typeof value === "string" ? value.length : 0}/{maxLength}
        </Text>
      )}
    </Box>
  );

  if (label || description || error) {
    return (
      <Box className="space-y-2">
        {label && (
          <Text
            as="label"
            htmlFor={textareaId}
            size="2"
            weight="medium"
            className="text-text"
          >
            {label}
          </Text>
        )}
        {textareaElement}
        {description && (
          <Text size="1" color="gray" className="text-text/60">
            {description}
          </Text>
        )}
        {error && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
      </Box>
    );
  }

  return textareaElement;
};
