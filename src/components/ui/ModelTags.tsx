// Shared component for displaying model metadata tags
// Used in both onboarding and settings pages

import { Badge } from "@radix-ui/themes";
import { TFunction } from "i18next";
import React from "react";
import type { ModelInfo } from "../../lib/types";
import {
  getModeKey,
  getTypeKey,
  orderLanguage,
  parseLanguageKeys,
  sizeBucket,
} from "../settings/asr-models/utils";

interface ModelTagsProps {
  model: ModelInfo;
  t: TFunction;
  showMode?: boolean;
  showType?: boolean;
  showLanguages?: boolean;
  showSize?: boolean;
}

/**
 * Reusable component for displaying model metadata as badges
 * Consolidates tag logic used across onboarding and settings pages
 */
export const ModelTags: React.FC<ModelTagsProps> = ({
  model,
  t,
  showMode = true,
  showType = true,
  showLanguages = true,
  showSize = true,
}) => {
  // Size badge
  const size = model.size_mb;
  const sizeText = size != null ? `${size} MB` : null;
  const sizeKind = sizeBucket(size);
  const sizeColor =
    sizeKind === "small"
      ? "green"
      : sizeKind === "medium"
        ? "amber"
        : sizeKind === "large"
          ? "red"
          : "gray";

  // Mode badge (streaming/offline/punctuation)
  const modeKey = getModeKey(model);
  const modeColor =
    modeKey === "streaming"
      ? "green" // 实时转录 - 绿色
      : modeKey === "punctuation"
        ? "purple" // 标点模型 - 紫色
        : "blue"; // 完整转录 - 蓝色

  // Type badge
  const typeKey = getTypeKey(model);
  const getSimpleTypeName = (): string => {
    const translation = t(`settings.asrModels.typeChips.${typeKey}`);
    return translation.replace(/^Sherpa\s+/i, "");
  };

  // Language badges
  const languages = parseLanguageKeys(model);
  const isMultilingual = languages.includes("multilingual");
  const languageBadges = isMultilingual
    ? languages
        .filter((l) => l !== "multilingual" && l !== "other")
        .sort((a, b) => orderLanguage(a) - orderLanguage(b))
    : languages.filter((l) => l !== "other");

  return (
    <>
      {/* Size Badge */}
      {showSize && sizeText && (
        <Badge variant="soft" color={sizeColor} size="1">
          {sizeText}
        </Badge>
      )}

      {/* Mode Badge (Streaming/Offline/Punctuation) */}
      {showMode && (
        <Badge variant="soft" color={modeColor} size="1">
          {t(`settings.asrModels.modeChips.${modeKey}`)}
        </Badge>
      )}

      {/* Language Badges */}
      {showLanguages &&
        languageBadges.map((l) => (
          <Badge key={`lang:${l}`} variant="soft" color="gray" size="1">
            {t(`settings.asrModels.languages.${l}`)}
          </Badge>
        ))}

      {/* Type Badge */}
      {showType && (
        <Badge variant="outline" color="gray" size="1">
          {getSimpleTypeName()}
        </Badge>
      )}
    </>
  );
};

export default ModelTags;
