import { IconChevronDown } from "@tabler/icons-react";
import { Badge, Box, Button, Text } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface ModelStatusButtonProps {
  status: ModelStatus;
  displayText: string;
  isDropdownOpen: boolean;
  onClick: () => void;
  className?: string;
  modeLabel?: string;
  modeLabelColor?: string;
  isOnlineModel?: boolean;
}

const ModelStatusButton: React.FC<ModelStatusButtonProps> = ({
  status,
  displayText,
  isDropdownOpen,
  onClick,
  className = "",
  modeLabelColor,
  modeLabel,
  isOnlineModel = false,
}) => {
  const { t } = useTranslation();
  const getStatusColor = (status: ModelStatus): string => {
    if (isOnlineModel) {
      return "bg-blue-500";
    }
    switch (status) {
      case "ready":
        return "bg-green-400";
      case "loading":
        return "bg-yellow-400 animate-pulse";
      case "downloading":
        return "bg-logo-primary animate-pulse";
      case "extracting":
        return "bg-orange-400 animate-pulse";
      case "error":
        return "bg-red-400";
      case "unloaded":
        return "bg-mid-gray/60";
      case "none":
        return "bg-red-400";
      default:
        return "bg-mid-gray/60";
    }
  };

  return (
    <Button
      onClick={onClick}
      variant="ghost"
      color={isOnlineModel ? "blue" : "gray"}
      size="1"
      className={`flex items-center gap-2 ${className}`}
      title={displayText}
    >
      <Box className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
      <Text weight="medium">{displayText}</Text>
      <Badge size="1" variant="soft" radius="full" className={modeLabelColor}>
        {modeLabel ??
          (isOnlineModel
            ? t("modelSelector.online")
            : t("modelSelector.local"))}
      </Badge>
      <IconChevronDown
        className={`w-3 h-3 transition-transform ${
          isDropdownOpen ? "rotate-180" : ""
        }`}
      />
    </Button>
  );
};

export default ModelStatusButton;
