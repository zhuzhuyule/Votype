// ModelGroup - Displays a group of models by mode (streaming, offline, punctuation)

import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import { TFunction } from "i18next";
import React from "react";
import type { ModelInfo } from "../../../../lib/types";
import type { ModeKey } from "../types";
import { ModelCard } from "./ModelCard";

interface ModelGroupProps {
  mode: ModeKey;
  models: ModelInfo[];
  t: TFunction;
  favoriteSet: Set<string>;
  busy: boolean;
  onToggleFavorite: (modelId: string) => void;
  onDownload: (modelId: string) => void;
  onDeleteFiles: (modelId: string) => void;
  onEdit: (model: ModelInfo) => void;
  onRemove: (modelId: string) => void;
}

export const ModelGroup: React.FC<ModelGroupProps> = ({
  mode,
  models,
  t,
  favoriteSet,
  busy,
  onToggleFavorite,
  onDownload,
  onDeleteFiles,
  onEdit,
  onRemove,
}) => {
  // Determine styling based on mode
  let textClass = "text-gray-700 dark:text-gray-300";
  let badgeColor: "gray" | "blue" | "amber" = "gray";

  if (mode === "streaming") {
    textClass = "text-blue-600 dark:text-blue-400";
    badgeColor = "blue";
  } else if (mode === "offline") {
    textClass = "text-stone-600 dark:text-stone-300";
    badgeColor = "gray";
  } else if (mode === "punctuation") {
    textClass = "text-amber-600 dark:text-amber-400";
    badgeColor = "amber";
  }

  return (
    <Box className="space-y-2">
      <Flex justify="between" align="center">
        <Text size="2" weight="medium" className={textClass}>
          {t(`settings.asrModels.groups.${mode}`)}
        </Text>
        <Badge variant="soft" color={badgeColor}>
          {models.length}
        </Badge>
      </Flex>
      <Box className="space-y-2">
        {models.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            t={t}
            isFavorite={favoriteSet.has(model.id)}
            busy={busy}
            onToggleFavorite={onToggleFavorite}
            onDownload={onDownload}
            onDeleteFiles={onDeleteFiles}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        ))}
      </Box>
    </Box>
  );
};
