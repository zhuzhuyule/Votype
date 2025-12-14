import { Box, Flex, IconButton, ScrollArea, Text } from "@radix-ui/themes";
import {
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconCube,
  IconDeviceDesktop,
  IconDownload,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import { ProgressBar } from "../shared";

const RECOMMENDED_MODEL_IDS = new Set([
  "sherpa-paraformer-zh-en-streaming",
  "sherpa-paraformer-trilingual-zh-cantonese-en",
  "punct-zh-en-ct-transformer-2024-04-12-int8",
  "sherpa-paraformer-zh-small-2024-03-09",
]);

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
  asrModels,
  selectedAsrModelId,
  onAsrModelSelect,
  onlineEnabled,
}) => {
  const { t } = useTranslation();
  const [expandedSections, setExpandedSections] = React.useState(
    () => new Set(["downloaded", "downloadable", "online"]),
  );

  const getFamily = React.useCallback((model: ModelInfo) => {
    if (model.engine_type === "Whisper") return "Whisper";
    if (model.engine_type === "Parakeet") return "Parakeet";
    if (model.engine_type === "SherpaOnnxPunctuation") return "Punctuation";
    if (model.engine_type === "SherpaOnnx") {
      if (model.sherpa?.mode === "Streaming") return "Sherpa (Streaming)";
      if (model.sherpa?.mode === "Offline") return "Sherpa (Offline)";
      return "Sherpa";
    }
    return "Other";
  }, []);

  const orderFamily = (family: string) => {
    switch (family) {
      case "Whisper":
        return 0;
      case "Parakeet":
        return 1;
      case "Sherpa (Streaming)":
        return 2;
      case "Sherpa (Offline)":
        return 3;
      case "Punctuation":
        return 4;
      default:
        return 5;
    }
  };

  const availableModels = models
    .filter((m) => m.is_downloaded)
    .sort((a, b) => {
      const fa = orderFamily(getFamily(a));
      const fb = orderFamily(getFamily(b));
      if (fa !== fb) return fa - fb;
      if (a.id === currentModelId) return -1;
      if (b.id === currentModelId) return 1;
      return a.name.localeCompare(b.name);
    });

  const downloadableModels = models
    .filter((m) => !m.is_downloaded)
    .sort((a, b) => {
      const fa = orderFamily(getFamily(a));
      const fb = orderFamily(getFamily(b));
      if (fa !== fb) return fa - fb;
      return a.size_mb - b.size_mb;
    });

  const isFirstRun = availableModels.length === 0 && models.length > 0;

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

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderSectionHeader = (
    key: string,
    icon: React.ReactNode,
    label: string,
    count: number,
  ) => {
    const isOpen = expandedSections.has(key);
    return (
      <Box
        role="button"
        tabIndex={0}
        onClick={() => toggleSection(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleSection(key);
          }
        }}
        className="px-4 py-2 text-xs font-medium text-text/60 uppercase tracking-wider flex items-center justify-between cursor-pointer select-none hover:bg-mid-gray/5"
      >
        <Flex align="center" gap="2">
          {icon}
          <span>
            {label} <span className="text-text/40 font-normal">({count})</span>
          </span>
        </Flex>
        <IconChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </Box>
    );
  };

  const renderGroupedModels = (
    list: ModelInfo[],
    renderItem: (m: ModelInfo) => React.ReactNode,
  ) => {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of list) {
      const key = getFamily(model);
      const arr = groups.get(key) ?? [];
      arr.push(model);
      groups.set(key, arr);
    }
    const ordered = Array.from(groups.entries()).sort(
      ([a], [b]) => orderFamily(a) - orderFamily(b),
    );
    return (
      <>
        {ordered.map(([family, items]) => (
          <Box key={family}>
            <Box className="px-4 pt-2 pb-1 text-[11px] font-medium text-text/45 uppercase tracking-wider">
              {family}{" "}
              <span className="text-text/30 font-normal">({items.length})</span>
            </Box>
            {items.map(renderItem)}
          </Box>
        ))}
      </>
    );
  };

  return (
    <Box className="absolute bottom-full left-0 mb-2 w-[28rem] max-h-[70vh] bg-background/95 backdrop-blur-sm border border-mid-gray/20 rounded-xl shadow-2xl z-50 shadow-black/20 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-bottom-left">
      {/* First Run Welcome */}
      {isFirstRun && (
        <Box className="px-4 py-3 bg-logo-primary/5 border-b border-logo-primary/10">
          <Text
            className="text-sm font-medium text-logo-primary mb-1 block"
            size="2"
          >
            {t("modelSelector.welcome")}
          </Text>
          <Text className="text-xs text-text/70" size="1">
            {t("modelSelector.downloadPrompt")}
          </Text>
        </Box>
      )}

      <ScrollArea type="hover" scrollbars="vertical" className="max-h-[60vh]">
        {/* Downloaded Models */}
        {availableModels.length > 0 &&
          renderSectionHeader(
            "downloaded",
            <IconDeviceDesktop className="w-3.5 h-3.5" />,
            t("modelSelector.availableModels"),
            availableModels.length,
          )}
        {availableModels.length > 0 && expandedSections.has("downloaded") && (
          <Box className="py-1">
            {renderGroupedModels(availableModels, (model) => {
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
                    isActive
                      ? "bg-logo-primary/5 border-logo-primary"
                      : "border-transparent"
                  }`}
                >
                  <Flex justify="between" align="center">
                    <Box>
                      <Flex align="center" gap="2" mb="1">
                        <Text
                          size="2"
                          weight="medium"
                          className={
                            isActive ? "text-logo-primary" : "text-text"
                          }
                        >
                          {getTranslatedModelName(model, t)}
                        </Text>
                        {RECOMMENDED_MODEL_IDS.has(model.id) ? (
                          <Text
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium border border-amber-100"
                            size="1"
                          >
                            {t("onboarding.recommended")}
                          </Text>
                        ) : null}
                        <Text
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-mid-gray/10 text-text/60 font-medium"
                          size="1"
                        >
                          {formatModelSize(model.size_mb)}
                        </Text>
                      </Flex>
                      {model.description && (
                        <Text
                          className="text-xs text-text/50 block leading-tight"
                          size="1"
                        >
                          {getTranslatedModelDescription(model, t)}
                        </Text>
                      )}
                    </Box>
                    {isActive && (
                      <IconCheck className="text-logo-primary w-5 h-5 flex-shrink-0" />
                    )}
                  </Flex>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Online ASR Models */}
        {asrModels.length > 0 && (
          <>
            {renderSectionHeader(
              "online",
              <IconCloud className="w-3.5 h-3.5" />,
              t("modelSelector.onlineAsrModels"),
              asrModels.length,
            )}
            {expandedSections.has("online") && (
              <Box className="py-1">
                {asrModels.map((model) => {
                  const isActive =
                    onlineEnabled && selectedAsrModelId === model.id;
                  return (
                    <Box
                      key={model.id}
                      onClick={() => {
                        onAsrModelSelect(model.id);
                      }}
                      className={`w-full px-4 py-2.5 text-left transition-all cursor-pointer focus:outline-none hover:bg-mid-gray/5 border-l-2 ${
                        isActive
                          ? "bg-logo-primary/5 border-logo-primary"
                          : "border-transparent"
                      }`}
                    >
                      <Flex justify="between" align="center">
                        <Box>
                          <Flex align="center" gap="2" mb="1">
                            <Text
                              size="2"
                              weight="medium"
                              className={
                                isActive ? "text-logo-primary" : "text-text"
                              }
                            >
                              {model.name}
                            </Text>
                            <Text
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium border border-blue-100"
                              size="1"
                            >
                              {model.providerLabel}
                            </Text>
                          </Flex>
                          <Text
                            className="text-xs text-text/50 block leading-tight"
                            size="1"
                          >
                            {onlineEnabled
                              ? t("modelSelector.onlineAsrActive")
                              : t("modelSelector.clickToEnableOnlineAsr")}
                          </Text>
                        </Box>
                        {isActive && (
                          <IconCheck className="text-logo-primary w-5 h-5 flex-shrink-0 ml-3" />
                        )}
                      </Flex>
                    </Box>
                  );
                })}
              </Box>
            )}
          </>
        )}

        {/* Downloadable Models */}
        {downloadableModels.length > 0 &&
          renderSectionHeader(
            "downloadable",
            <IconDownload className="w-3.5 h-3.5" />,
            t("modelSelector.downloadModels"),
            downloadableModels.length,
          )}
        {downloadableModels.length > 0 &&
          expandedSections.has("downloadable") && (
            <Box className="py-1 bg-mid-gray/5 border-t border-mid-gray/10">
              {renderGroupedModels(downloadableModels, (model) => {
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
                            {getTranslatedModelName(model, t)}
                          </Text>
                          <Text
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-mid-gray/10 text-text/60 font-medium"
                            size="1"
                          >
                            {formatModelSize(model.size_mb)}
                          </Text>
                          {model.id === "small" && isFirstRun && (
                            <Text
                              className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium"
                              size="1"
                            >
                              {t("onboarding.recommended")}
                            </Text>
                          )}
                        </Flex>
                        <Text
                          className="text-xs text-text/50 block leading-tight"
                          size="1"
                        >
                          {getTranslatedModelDescription(model, t)}
                        </Text>
                      </Box>

                      <Box className="flex-shrink-0 ml-3">
                        {isDownloading && progress ? (
                          <Box className="w-20">
                            <Text
                              className="text-xs text-logo-primary font-medium text-right block mb-1"
                              size="1"
                            >
                              {Math.max(
                                0,
                                Math.min(100, Math.round(progress.percentage)),
                              )}
                              %
                            </Text>
                            <ProgressBar
                              progress={[
                                {
                                  id: model.id,
                                  percentage: Math.max(
                                    0,
                                    Math.min(
                                      100,
                                      Math.round(progress.percentage),
                                    ),
                                  ),
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
                            title={t("modelSelector.download")}
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
        {availableModels.length === 0 &&
          downloadableModels.length === 0 &&
          asrModels.length === 0 && (
            <Box className="px-4 py-8 text-center">
              <IconCube className="w-8 h-8 text-mid-gray/30 mx-auto mb-2" />
              <Text className="text-sm text-text/60" size="2">
                {t("modelSelector.noModelsAvailable")}
              </Text>
            </Box>
          )}
      </ScrollArea>
    </Box>
  );
};

export default ModelDropdown;
