import { Button, Flex, Text } from "@radix-ui/themes";
import { IconDownload } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { formatModelSize } from "../../lib/utils/format";
import Badge from "../ui/Badge";

interface ModelCardProps {
  model: ModelInfo;
  variant?: "default" | "featured";
  disabled?: boolean;
  className?: string;
  onSelect: (modelId: string) => void;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  disabled = false,
  className = "",
  onSelect,
}) => {
  const isFeatured = variant === "featured";
  const { t } = useTranslation();

  const baseButtonClasses =
    "flex justify-between items-center rounded-xl p-3 px-4 text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-logo-primary/25 active:scale-[0.98] cursor-pointer group";

  const variantClasses = isFeatured
    ? "border-2 border-logo-primary/25 bg-logo-primary/5 hover:border-logo-primary/40 hover:bg-logo-primary/8 hover:shadow-lg hover:scale-[1.02] disabled:hover:border-logo-primary/25 disabled:hover:bg-logo-primary/5 disabled:hover:shadow-none disabled:hover:scale-100"
    : "border-2 border-mid-gray/20 hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-lg hover:scale-[1.02] disabled:hover:border-mid-gray/20 disabled:hover:bg-transparent disabled:hover:shadow-none disabled:hover:scale-100";

  return (
    <Button
      onClick={() => onSelect(model.id)}
      disabled={disabled}
      variant="ghost"
      size="2"
      className="w-full text-left justify-start h-auto p-0"
    >
      <Flex
        className={[
          "flex justify-between! items-center! rounded-xl p-3 px-4 text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-logo-primary/25 active:scale-[0.98] cursor-pointer group w-full",
          isFeatured
            ? "border-2 border-logo-primary/25 bg-logo-primary/5 hover:border-logo-primary/40 hover:bg-logo-primary/8 hover:shadow-lg hover:scale-[1.02] disabled:hover:border-logo-primary/25 disabled:hover:bg-logo-primary/5 disabled:hover:shadow-none disabled:hover:scale-100"
            : "border-2 border-mid-gray/20 hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-lg hover:scale-[1.02] disabled:hover:border-mid-gray/20 disabled:hover:bg-transparent disabled:hover:shadow-none disabled:hover:scale-100",
        ].join(" ")}
      >
        <Flex direction="column" className="items-start">
          <Flex align="center" gap="4">
            <Text
              size="5"
              weight="bold"
              className="group-hover:text-logo-primary transition-colors"
            >
              {model.name}
            </Text>
            {isFeatured && (
              <Badge variant="primary">{t("modelCard.recommended")}</Badge>
            )}
          </Flex>
          <Text size="2" color="gray" className="leading-relaxed">
            {t(model.description)}
          </Text>
        </Flex>

        <Flex justify="end" align="center" gap="3">
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text size="1" color="gray" className="w-16 text-right">
                {t("modelCard.accuracy")}
              </Text>
              <div className="w-20 h-2 bg-mid-gray/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-logo-primary rounded-full transition-all duration-300"
                  style={{ width: `${model.accuracy_score * 100}%` }}
                />
              </div>
            </Flex>
            <Flex align="center" gap="2">
              <Text size="1" color="gray" className="w-16 text-right">
                {t("modelCard.speed")}
              </Text>
              <div className="w-20 h-2 bg-mid-gray/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-logo-primary rounded-full transition-all duration-300"
                  style={{ width: `${model.speed_score * 100}%` }}
                />
              </div>
            </Flex>
          </Flex>
          <DownloadSize sizeMb={model.size_mb} />
        </Flex>
      </Flex>
    </Button>
  );
};

const DownloadSize = ({ sizeMb }: { sizeMb: number }) => {
  const { t } = useTranslation();
  return (
    <Flex align="center" gap="1.5" className="text-xs text-text/60 tabular-nums">
      <IconDownload
        aria-hidden="true"
        className="h-3.5 w-3.5 text-text/45"
      />
      <Text className="sr-only">{t("modelCard.downloadSize")}</Text>
      <Text weight="medium" color="gray">
        {formatModelSize(sizeMb)}
      </Text>
    </Flex>
  );
};

export default ModelCard;
