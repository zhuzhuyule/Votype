import { Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { IconDownload, IconThumbUpFilled } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { getTranslatedModelName } from "../../lib/utils/modelTranslation";
import { RECOMMENDED_MODEL_IDS } from "../settings/asr-models/constants";
import { ModelTags } from "../ui/ModelTags";

interface ModelCardProps {
  model: ModelInfo;
  variant?: "default" | "featured";
  disabled?: boolean;
  onSelect: (modelId: string) => void;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  disabled = false,
  onSelect,
}) => {
  const isFeatured = variant === "featured";
  const { t } = useTranslation();
  const isRecommended = RECOMMENDED_MODEL_IDS.has(model.id);

  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      className={[
        "rounded-xl px-4 py-3 transition-all duration-200",
        "cursor-pointer group",
        isFeatured
          ? "border border-logo-primary/30 bg-logo-primary/5 hover:border-logo-primary/50 hover:bg-logo-primary/8"
          : "border border-gray-200 bg-[var(--color-background)] hover:border-logo-primary/30 hover:bg-logo-primary/5",
        disabled ? "opacity-50 pointer-events-none" : "",
      ].join(" ")}
      onClick={() => !disabled && onSelect(model.id)}
    >
      {/* Left: Name & Tags */}
      <Flex direction="column" gap="2" className="flex-1 min-w-0">
        {/* Title Row */}
        <Flex align="center" gap="2" className="min-w-0">
          <Text
            size="3"
            weight="medium"
            className="group-hover:text-logo-primary transition-colors truncate"
          >
            {getTranslatedModelName(model, t)}
          </Text>
          {isRecommended && (
            <Tooltip content={t("onboarding.recommended")}>
              <IconThumbUpFilled className="w-4 h-4 text-amber-500 flex-shrink-0" />
            </Tooltip>
          )}
        </Flex>

        {/* Tags Row */}
        <Flex gap="1" wrap="wrap" align="center">
          <ModelTags
            model={model}
            t={t}
            showSize
            showMode
            showLanguages
            showType={false}
          />
        </Flex>
      </Flex>

      {/* Right: Download Button */}
      <Tooltip content={t("settings.asrModels.download")}>
        <IconButton
          size="2"
          variant="soft"
          color="gray"
          radius="full"
          className="shrink-0 group-hover:bg-logo-primary/20 group-hover:text-logo-primary transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onSelect(model.id);
          }}
        >
          <IconDownload className="w-4 h-4" />
        </IconButton>
      </Tooltip>
    </Flex>
  );
};

export default ModelCard;
