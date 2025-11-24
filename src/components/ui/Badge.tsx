import React from "react";
import { Flex, Text, IconButton } from "@radix-ui/themes";
import { IconX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "success" | "warning" | "error" | "info";
  className?: string;
  onRemove?: () => void;
}

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  className = "",
  onRemove,
}) => {
  const { t } = useTranslation();

  const getColor = () => {
    switch (variant) {
      case "primary":
        return "indigo";
      case "secondary":
        return "gray";
      case "success":
        return "green";
      case "warning":
        return "yellow";
      case "error":
        return "red";
      case "info":
        return "blue";
      default:
        return "indigo";
    }
  };

  const getVariant = () => {
    switch (variant) {
      case "secondary":
        return "soft";
      default:
        return "solid";
    }
  };

  return (
    <Flex
      align="center"
      gap="1"
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors duration-200 ${className}`}
    >
      <Text
        color={getColor()}
        as="span"
        size="1"
        weight="medium"
        className={getVariant() === "solid" ? "text-white" : ""}
      >
        {children}
      </Text>
      {onRemove && (
        <IconButton
          size="1"
          variant="ghost"
          color={getColor()}
          onClick={onRemove}
          aria-label={t("common.remove")}
          className="ml-1 hover:bg-black/20 transition-colors"
        >
          <IconX width={12} height={12} />
        </IconButton>
      )}
    </Flex>
  );
};

export default Badge;
export { Badge };
