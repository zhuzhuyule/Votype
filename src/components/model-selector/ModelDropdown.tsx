import React from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { formatModelSize } from "../../lib/utils/format";
import { ProgressBar } from "../shared";

interface DownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

interface ModelDropdownProps {
  models: ModelInfo[];
  currentModelId: string;
  downloadProgress: Map<string, DownloadProgress>;
  onModelSelect: (modelId: string) => void;
  onModelDownload: (modelId: string) => void;
  onModelDelete: (modelId: string) => Promise<void>;
  onError?: (error: string) => void;
  asrModels: {
    id: string;
    name: string;
    providerLabel: string;
  }[];
  selectedAsrModelId: string | null;
  onAsrModelSelect: (modelId: string) => void;
  onlineEnabled: boolean;
}

const ModelDropdown: React.FC<ModelDropdownProps> = ({
  models,
  currentModelId,
  downloadProgress,
  onModelSelect,
  onModelDownload,
  onModelDelete,
  onError,
  asrModels,
  selectedAsrModelId,
  onAsrModelSelect,
  onlineEnabled,
}) => {
  const { t } = useTranslation();
  const availableModels = models.filter((m) => m.is_downloaded);
  const downloadableModels = models.filter((m) => !m.is_downloaded);
  const isFirstRun = availableModels.length === 0 && models.length > 0;

  const handleDeleteClick = async (e: React.MouseEvent, modelId: string) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await onModelDelete(modelId);
    } catch (err) {
      const errorMsg = t("error.failedDeleteModel", { error: err });
      onError?.(errorMsg);
    }
  };

  const handleModelClick = (modelId: string) => {
    if (downloadProgress.has(modelId)) {
      return; // Don't allow interaction while downloading
    }
    onModelSelect(modelId);
  };

  const handleDownloadClick = (modelId: string) => {
    if (downloadProgress.has(modelId)) {
      return; // Don't allow interaction while downloading
    }
    onModelDownload(modelId);
  };

  return (
    <Box className="absolute bottom-full left-0 mb-2 w-64 bg-background border border-mid-gray/20 rounded-lg shadow-xl py-2 z-50 shadow-black/10">
      {/* First Run Welcome */}
      {isFirstRun && (
        <Box className="px-3 py-2 bg-logo-primary/10 border-b border-logo-primary/20">
          <Text className="text-xs font-medium text-logo-primary mb-1" size="1">
            {t("modelDropdown.welcome")}
          </Text>
          <Text className="text-xs text-text/70" size="1">
            {t("modelDropdown.getStarted")}
          </Text>
        </Box>
      )}

      {/* Available Models */}
      {availableModels.length > 0 && (
        <Box>
          <Text className="px-3 py-1 text-xs font-medium text-text/80 border-b border-mid-gray/10" size="1">
            {t("modelDropdown.availableModels")}
          </Text>
          {availableModels.map((model) => (
            <Box
              key={model.id}
              onClick={() => handleModelClick(model.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleModelClick(model.id);
                }
              }}
              tabIndex={0}
              role="button"
              className={`w-full px-3 py-2 text-left hover:bg-mid-gray/10 transition-colors cursor-pointer focus:outline-none ${
                currentModelId === model.id
                  ? "bg-logo-primary/10 text-logo-primary"
                  : ""
              }`}
            >
              <Flex justify="between">
                <Text size="2">{model.name}</Text>
                <Text className="text-xs text-text/40 italic pr-4" size="1">
                  {formatModelSize(model.size_mb)}
                </Text>
              </Flex>
              {currentModelId === model.id && (
                <Flex align="center" gap="2">
                  <Text className="text-xs text-logo-primary" size="1">
                    {t("modelDropdown.active")}
                  </Text>
                </Flex>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Online ASR Models */}
      {asrModels.length > 0 && (
        <Box>
          {(availableModels.length > 0 || isFirstRun) && (
            <Box className="border-t border-mid-gray/10 my-1" />
          )}
          <Text className="px-3 py-1 text-xs font-medium text-text/80" size="1">
            {t("modelDropdown.onlineAsrModels")}
          </Text>
          {asrModels.map((model) => (
            <Box
              key={model.id}
              onClick={() => {
                if (!onlineEnabled) {
                  onAsrModelSelect(model.id);
                } else {
                  onAsrModelSelect(model.id);
                }
              }}
              className={`w-full px-3 py-2 text-left transition-colors cursor-pointer focus:outline-none ${
                selectedAsrModelId === model.id
                  ? "bg-logo-primary/10 text-logo-primary"
                  : "hover:bg-mid-gray/10"
              }`}
            >
              <Flex justify="between">
                <Text size="2">{model.name}</Text>
                <Text className="text-xs text-text/40 italic" size="1">{model.providerLabel}</Text>
              </Flex>
              <Text className="text-[10px] text-center text-mid-gray/70 mt-1" size="1">
                {onlineEnabled ? t("modelDropdown.onlineAsrActive") : t("modelDropdown.clickToEnable")}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Downloadable Models */}
      {downloadableModels.length > 0 && (
        <Box>
          <Box className="border-t border-mid-gray/10 my-1" />
          <Text className="px-3 py-1 text-xs font-medium text-text/80" size="1">
            {t("modelDropdown.downloadableModels")}
          </Text>
          {downloadableModels.map((model) => {
            const isDownloading = downloadProgress.has(model.id);
            const progress = downloadProgress.get(model.id);

            return (
              <Box
                key={model.id}
                onClick={() => handleDownloadClick(model.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleDownloadClick(model.id);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-disabled={isDownloading}
                className={`w-full px-3 py-2 text-left hover:bg-mid-gray/10 transition-colors cursor-pointer focus:outline-none ${
                  isDownloading
                    ? "opacity-50 cursor-not-allowed hover:bg-transparent"
                    : ""
                }`}
              >
                <Flex justify="between">
                  <Box>
                    <Text size="2">
                      {model.name}
                      {model.id === "small" && isFirstRun && (
                        <Text className="ml-2 text-xs bg-logo-primary/20 text-logo-primary px-1.5 py-0.5 rounded" size="1">
                          {t("modelDropdown.recommended")}
                        </Text>
                      )}
                    </Text>
                    <Text className="text-xs text-text/40 italic pr-4" size="1">
                      {model.description}
                    </Text>
                    <Text className="mt-1 text-xs text-text/50 tabular-nums" size="1">
                      {t("modelDropdown.downloadSize")} · {formatModelSize(model.size_mb)}
                    </Text>
                  </Box>
                  <Text className="text-xs text-logo-primary tabular-nums" size="1">
                    {isDownloading && progress
                      ? `${Math.max(0, Math.min(100, Math.round(progress.percentage)))}%`
                      : t("modelDropdown.download")}
                  </Text>
                </Flex>

                {isDownloading && progress && (
                  <Box mt="2">
                    <ProgressBar
                      progress={[
                        {
                          id: model.id,
                          percentage: Math.max(0, Math.min(100, Math.round(progress.percentage))),
                        },
                      ]}
                      size="small"
                    />
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* No Models Available */}
      {availableModels.length === 0 && downloadableModels.length === 0 && (
        <Text className="px-3 py-2 text-sm text-text/60" size="2">
          {t("modelDropdown.noModelsAvailable")}
        </Text>
      )}
    </Box>
  );
};

export default ModelDropdown;