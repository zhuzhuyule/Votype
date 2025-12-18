// ModelCard - Displays a single ASR model with its metadata and actions

import {
    Badge,
    Box,
    Card,
    Flex,
    Heading,
    IconButton,
    Text,
    Tooltip,
} from "@radix-ui/themes";
import {
    IconDownload,
    IconPencil,
    IconStar,
    IconStarFilled,
    IconThumbUpFilled,
    IconTrash,
} from "@tabler/icons-react";
import { TFunction } from "i18next";
import React from "react";
import type { ModelInfo } from "../../../../lib/types";
import {
    getTranslatedModelName
} from "../../../../lib/utils/modelTranslation";
import { RECOMMENDED_MODEL_IDS } from "../constants";
import type { TypeKey } from "../types";
import { getTypeKey, orderLanguage, parseLanguageKeys, sizeBucket } from "../utils";

interface ModelCardProps {
    model: ModelInfo;
    t: TFunction;
    isFavorite: boolean;
    busy: boolean;
    onToggleFavorite: (modelId: string) => void;
    onDownload: (modelId: string) => void;
    onDeleteFiles: (modelId: string) => void;
    onEdit: (model: ModelInfo) => void;
    onRemove: (modelId: string) => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({
    model,
    t,
    isFavorite,
    busy,
    onToggleFavorite,
    onDownload,
    onDeleteFiles,
    onEdit,
    onRemove,
}) => {
    const title = getTranslatedModelName(model, t);
    const isRecommended = RECOMMENDED_MODEL_IDS.has(model.id);
    const languages = parseLanguageKeys(model);
    const isMultilingual = languages.includes("multilingual");
    const languageBadges = isMultilingual
        ? languages
            .filter((l) => l !== "multilingual" && l !== "other")
            .sort((a, b) => orderLanguage(a) - orderLanguage(b))
        : languages.filter((l) => l !== "other");

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

    const typeKey = getTypeKey(model);

    // Simplify type chip display - remove "Sherpa " prefix
    const getSimpleTypeName = (key: TypeKey): string => {
        const translation = t(`settings.asrModels.typeChips.${key}`);
        return translation.replace(/^Sherpa\s+/i, "");
    };

    const canFavorite = model.engine_type !== "SherpaOnnxPunctuation";

    return (
        <Card key={model.id} variant="surface" className="p-3">
            <Flex justify="between" align="center" gap="3">
                <Box className="min-w-0 flex-1 space-y-1">
                    {/* Line 1: Title + Recommended + ID */}
                    <Flex align="center" gap="2" className="min-w-0">
                        <Heading
                            as="h3"
                            size="3"
                            weight="medium"
                            className="text-gray-900 dark:text-gray-100 truncate flex-shrink-0"
                        >
                            {title}
                        </Heading>
                        {isRecommended && (
                            <Tooltip content={t("onboarding.recommended")}>
                                <IconThumbUpFilled className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            </Tooltip>
                        )}
                        <Text
                            size="1"
                            className="text-gray-400 dark:text-gray-500 font-mono truncate"
                        >
                            {model.id}
                        </Text>
                    </Flex>

                    {/* Line 2: Size, Language, Type badges */}
                    <Flex align="center" gap="1" wrap="wrap">
                        {sizeText && (
                            <Badge variant="soft" color={sizeColor} size="1">
                                {sizeText}
                            </Badge>
                        )}
                        {languageBadges.map((l) => (
                            <Badge
                                key={`${model.id}:lang:${l}`}
                                variant="soft"
                                color="gray"
                                size="1"
                            >
                                {t(`settings.asrModels.languages.${l}`)}
                            </Badge>
                        ))}
                        <Badge variant="soft" color="gray" size="1">
                            {getSimpleTypeName(typeKey)}
                        </Badge>
                    </Flex>
                </Box>

                {/* Right section: Actions */}
                <Flex gap="2" align="center" className="flex-shrink-0">
                    {/* Favorite toggle */}
                    <Tooltip content={t("settings.asrModels.favorite")}>
                        <IconButton
                            size="2"
                            variant={isFavorite ? "solid" : "soft"}
                            color={isFavorite ? "amber" : "gray"}
                            onClick={() => onToggleFavorite(model.id)}
                            disabled={busy || !canFavorite}
                        >
                            {isFavorite ? (
                                <IconStarFilled className="w-4 h-4" />
                            ) : (
                                <IconStar className="w-4 h-4" />
                            )}
                        </IconButton>
                    </Tooltip>

                    {/* Download / Delete files */}
                    {model.is_downloaded ? (
                        <Tooltip content={t("settings.asrModels.delete")}>
                            <IconButton
                                size="2"
                                color="red"
                                variant="soft"
                                onClick={() => onDeleteFiles(model.id)}
                                disabled={busy}
                            >
                                <IconTrash className="w-4 h-4" />
                            </IconButton>
                        </Tooltip>
                    ) : (
                        <Tooltip content={t("settings.asrModels.download")}>
                            <IconButton
                                size="2"
                                variant="soft"
                                onClick={() => onDownload(model.id)}
                                disabled={busy}
                            >
                                <IconDownload className="w-4 h-4" />
                            </IconButton>
                        </Tooltip>
                    )}

                    {/* Edit custom model */}
                    {!model.is_default && (
                        <Tooltip
                            content={t("settings.asrModels.install.edit") || "Edit custom model"}
                        >
                            <IconButton
                                size="2"
                                variant="soft"
                                onClick={() => onEdit(model)}
                                disabled={busy}
                            >
                                <IconPencil className="w-4 h-4" />
                            </IconButton>
                        </Tooltip>
                    )}

                    {/* Remove custom model */}
                    {!model.is_default && (
                        <Tooltip
                            content={t("settings.asrModels.install.remove") || "Remove custom model"}
                        >
                            <IconButton
                                size="2"
                                color="red"
                                variant="soft"
                                onClick={() => onRemove(model.id)}
                                disabled={busy}
                            >
                                <IconTrash className="w-4 h-4" />
                            </IconButton>
                        </Tooltip>
                    )}
                </Flex>
            </Flex>
        </Card>
    );
};
