import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import {
  IconCheck,
  IconCloud,
  IconCube,
  IconDeviceDesktop,
  IconDownload,
  IconTrash,
} from "@tabler/icons-react";
import React from "react";
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

    <Box className="absolute bottom-full left-0 mb-2 w-96 bg-background/95 backdrop-blur-sm border border-mid-gray/20 rounded-xl shadow-2xl py-2 z-50 shadow-black/20 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-bottom-left">
      {/* First Run Welcome */}
      {isFirstRun && (
        <Box className="px-4 py-3 bg-logo-primary/5 border-b border-logo-primary/10">
          <Text className="text-sm font-medium text-logo-primary mb-1 block" size="2">
            {t("modelDropdown.welcome")}
          </Text>
          <Text className="text-xs text-text/70" size="1">
            {t("modelDropdown.getStarted")}
          </Text>
        </Box>
      )}

      {/* Available Models */}
      {availableModels.length > 0 && (
        <Box className="py-1">
          <Flex align="center" gap="2" className="px-4 py-1.5 text-xs font-medium text-text/50 uppercase tracking-wider">
            <IconDeviceDesktop className="w-3.5 h-3.5" />
            {t("modelDropdown.availableModels")}
          </Flex>
          {availableModels.map((model) => {
            const isActive = !onlineEnabled && currentModelId === model.id;
            return (
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
                className={`w-full px-4 py-2.5 text-left hover:bg-mid-gray/5 transition-all cursor-pointer focus:outline-none border-l-2 group ${
                  isActive ? "bg-logo-primary/5 border-logo-primary" : "border-transparent"
                }`}
              >
                <Flex justify="between" align="center">
                  <Box>
                    <Flex align="center" gap="2" mb="1">
                      <Text size="2" weight="medium" className={isActive ? "text-logo-primary" : "text-text"}>
                        {model.name}
                      </Text>
                      <Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-mid-gray/10 text-text/60 font-medium" size="1">
                        {formatModelSize(model.size_mb)}
                      </Text>
                    </Flex>
                    {model.description && (
                      <Text className="text-xs text-text/50 block leading-tight" size="1">
                        {model.description}
                      </Text>
                    )}
                  </Box>
                  <Flex align="center" gap="3">
                    {isActive && <IconCheck className="text-logo-primary w-5 h-5 flex-shrink-0" />}
                    <IconButton
                      variant="ghost"
                      color="red"
                      size="1"
                      onClick={(e) => handleDeleteClick(e, model.id)}
                      className="rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      title={t("modelDropdown.delete", { name: model.name })}
                    >
                      <IconTrash className="w-4 h-4" />
                    </IconButton>
                  </Flex>
                </Flex>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Online ASR Models */}
      {asrModels.length > 0 && (
        <Box className="py-1">
          {(availableModels.length > 0 || isFirstRun) && (
            <Box className="mx-4 my-2 border-t border-mid-gray/10" />
          )}
          <Flex align="center" gap="2" className="px-4 py-1.5 text-xs font-medium text-text/50 uppercase tracking-wider">
            <IconCloud className="w-3.5 h-3.5" />
            {t("modelDropdown.onlineAsrModels")}
          </Flex>
          {asrModels.map((model) => {
            const isActive = onlineEnabled && selectedAsrModelId === model.id;
            return (
              <Box
                key={model.id}
                onClick={() => {
                  onAsrModelSelect(model.id);
                }}
                className={`w-full px-4 py-2.5 text-left transition-all cursor-pointer focus:outline-none hover:bg-mid-gray/5 border-l-2 ${
                  isActive ? "bg-logo-primary/5 border-logo-primary" : "border-transparent"
                }`}
              >
                <Flex justify="between" align="center">
                  <Box>
                    <Flex align="center" gap="2" mb="1">
                      <Text size="2" weight="medium" className={isActive ? "text-logo-primary" : "text-text"}>
                        {model.name}
                      </Text>
                      <Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium border border-blue-100" size="1">
                        {model.providerLabel}
                      </Text>
                    </Flex>
                    <Text className="text-xs text-text/50 block leading-tight" size="1">
                      {onlineEnabled ? t("modelDropdown.onlineAsrActive") : t("modelDropdown.clickToEnable")}
                    </Text>
                  </Box>
                  {isActive && <IconCheck className="text-logo-primary w-5 h-5 flex-shrink-0 ml-3" />}
                </Flex>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Downloadable Models */}
      {downloadableModels.length > 0 && (
        <Box className="py-1 bg-mid-gray/5 mt-2 border-t border-mid-gray/10">
          <Flex align="center" gap="2" className="px-4 py-2 text-xs font-medium text-text/50 uppercase tracking-wider">
            <IconDownload className="w-3.5 h-3.5" />
            {t("modelDropdown.downloadableModels")}
          </Flex>
          {downloadableModels.map((model) => {
            const isDownloading = downloadProgress.has(model.id);
            const progress = downloadProgress.get(model.id);

            return (
              <Box
                key={model.id}
                className="w-full px-4 py-2.5 text-left hover:bg-mid-gray/5 transition-all border-l-2 border-transparent group"
              >
                <Flex justify="between" align="center">
                  <Box>
                    <Flex align="center" gap="2" mb="1">
                      <Text size="2" weight="medium" className="text-text">
                        {model.name}
                      </Text>
                      <Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-mid-gray/10 text-text/60 font-medium" size="1">
                        {formatModelSize(model.size_mb)}
                      </Text>
                      {model.id === "small" && isFirstRun && (
                        <Text className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium" size="1">
                          {t("modelDropdown.recommended")}
                        </Text>
                      )}
                    </Flex>
                    <Text className="text-xs text-text/50 block leading-tight" size="1">
                      {model.description}
                    </Text>
                  </Box>

                  <Box className="flex-shrink-0 ml-3">
                    {isDownloading && progress ? (
                      <Box className="w-20">
                        <Text className="text-xs text-logo-primary font-medium text-right block mb-1" size="1">
                          {Math.max(0, Math.min(100, Math.round(progress.percentage)))}%
                        </Text>
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
                    ) : (
                      <IconButton
                        variant="ghost"
                        size="1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadClick(model.id);
                        }}
                        className="rounded-full hover:bg-logo-primary/10 text-logo-primary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title={t("modelDropdown.download")}
                      >
                        <IconDownload className="w-4 h-4" />
                      </IconButton>
                    )}
                  </Box>
                </Flex>
              </Box>
            );
          })}
        </Box>
      )}

      {/* No Models Available */}
      {availableModels.length === 0 && downloadableModels.length === 0 && (
        <Box className="px-4 py-8 text-center">
          <IconCube className="w-8 h-8 text-mid-gray/30 mx-auto mb-2" />
          <Text className="text-sm text-text/60" size="2">
            {t("modelDropdown.noModelsAvailable")}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default ModelDropdown;