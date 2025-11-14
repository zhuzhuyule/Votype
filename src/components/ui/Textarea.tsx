import React from "react";
import { Text, TextArea } from "@radix-ui/themes";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
  label?: string;
  error?: string;
  description?: string;
  showCharCount?: boolean;
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
  ...props
}) => {
  const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
  
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
    <div className="relative">
      <TextArea
        id={textareaId}
        size={getSize()}
        disabled={props.disabled}
        className={`${className} ${
          error ? "" : ""
        }`}
        style={{ minHeight: getMinHeight() }}
        color={error ? "red" : undefined}
        value={value}
        onChange={props.onChange}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
        placeholder={props.placeholder}
        required={props.required}
        maxLength={props.maxLength}
        minLength={props.minLength}
        rows={props.rows}
        resize={props.resize}
      />
      {showCharCount && props.maxLength && (
        <div className="absolute bottom-2 right-2 text-xs text-text/60 bg-background px-1 rounded">
          {typeof value === "string" ? value.length : 0}/{props.maxLength}
        </div>
      )}
    </div>
  );

  if (label || description || error) {
    return (
      <div className="space-y-2">
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
      </div>
    );
  }

  return textareaElement;
};
