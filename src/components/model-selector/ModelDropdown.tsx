import { Box, Flex, IconButton, ScrollArea, Text } from "@radix-ui/themes";
import {
  IconCheck,
  IconChevronRight,
  IconCloud,
  IconCube,
  IconDeviceDesktop,
  IconDownload,
  IconX,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { formatModelSize } from "../../lib/utils/format";
import { getTranslatedModelName } from "../../lib/utils/modelTranslation";
import { ProgressBar } from "../shared";

const RECOMMENDED_MODEL_IDS = new Set([
  "sherpa-paraformer-zh-en-streaming",
  "sherpa-paraformer-trilingual-zh-cantonese-en",
  "punct-zh-en-ct-transformer-2024-04-12-int8",
  "sherpa-paraformer-zh-small-2024-03-09",
]);

type LanguageKey =
  | "zh"
  | "yue"
  | "en"
  | "ja"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "ru";

const parseLanguageKeys = (modelId: string): LanguageKey[] => {
  const id = modelId.toLowerCase();
  const tokenSet = new Set<LanguageKey>();

  const re = /(^|[-_])(zh|yue|ct|cantonese|en|ja|ko|de|es|fr|ru)(?=([-_]|$))/g;
  for (const match of id.matchAll(re)) {
    const tok = match[2];
    if (tok === "ct" || tok === "cantonese") tokenSet.add("yue");
    else tokenSet.add(tok as LanguageKey);
  }

  if (id === "sherpa-paraformer-zh-small-2024-03-09") {
    tokenSet.add("zh");
    tokenSet.add("en");
  }

  return Array.from(tokenSet);
};

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
  onAsrModelSelect: (modelId: string, opts?: { keepOpen?: boolean }) => void;
  onlineEnabled: boolean;
  realtimeModels: ModelInfo[];
  selectedRealtimeModelId: string | null;
  realtimeEnabled: boolean;
  onRealtimeModelSelect: (modelId: string | null) => void;
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
  realtimeModels,
  selectedRealtimeModelId,
  realtimeEnabled,
  onRealtimeModelSelect,
}) => {
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [realtimePicker, setRealtimePicker] = React.useState<{
    asrId: string;
    style: React.CSSProperties;
  } | null>(null);

  const selectedRealtimeName =
    selectedRealtimeModelId == null
      ? null
      : realtimeModels.find((m) => m.id === selectedRealtimeModelId)
        ? getTranslatedModelName(
          realtimeModels.find((m) => m.id === selectedRealtimeModelId)!,
          t,
        )
        : selectedRealtimeModelId;

  React.useEffect(() => {
    if (!realtimePicker) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const panelEl = panelRef.current;
      if (!target || !panelEl) {
        setRealtimePicker(null);
        return;
      }
      if (panelEl.contains(target)) return;
      setRealtimePicker(null);
    };

    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, [realtimePicker]);

  const getFeatureTags = (m: ModelInfo): string[] => {
    const tags: string[] = [];
    const id = m.id.toLowerCase();

    if (m.engine_type === "SherpaOnnxPunctuation") {
      tags.push(t("settings.asrModels.groups.punctuation"));
    } else if (m.engine_type === "SherpaOnnx") {
      if (m.sherpa?.mode === "Streaming") {
        tags.push(t("settings.asrModels.groups.streaming"));
      }
      if (m.sherpa?.mode === "Offline") {
        tags.push(t("settings.asrModels.groups.offline"));
      }
    }

    if (id.includes("int8")) tags.push("INT8");
    if (id.includes("trilingual")) tags.push("Trilingual");
    if (id.includes("bilingual")) tags.push("Bilingual");

    return tags;
  };

  const getFamily = React.useCallback((model: ModelInfo) => {
    if (model.engine_type === "Whisper") return "Whisper";
    if (model.engine_type === "Parakeet") return "Parakeet";
    if (model.engine_type === "SherpaOnnxPunctuation") return "Punctuation";
    if (model.engine_type === "SherpaOnnx") return "Sherpa";
    return "Other";
  }, []);

  const orderFamily = (family: string) => {
    switch (family) {
      case "Whisper":
        return 0;
      case "Parakeet":
        return 1;
      case "Sherpa":
        return 2;
      case "Punctuation":
        return 3;
      default:
        return 4;
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

  const renderSectionHeader = (
    icon: React.ReactNode,
    label: string,
    count: number,
  ) => {
    return (
      <Box className="px-4 py-2 text-xs font-medium text-text/60 uppercase tracking-wider flex items-center justify-between select-none">
        <Flex align="center" gap="2">
          {icon}
          <span>
            {label} <span className="text-text/40 font-normal">({count})</span>
          </span>
        </Flex>
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
    <Box
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 w-[28rem] max-h-[70vh] bg-background/95 backdrop-blur-sm border border-mid-gray/20 rounded-xl shadow-2xl z-50 shadow-black/20 overflow-visible animate-in fade-in zoom-in-95 duration-200 origin-bottom-left"
    >
      <Box className="overflow-hidden rounded-xl">
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
              <IconDeviceDesktop className="w-3.5 h-3.5" />,
              t("modelSelector.availableModels"),
              availableModels.length,
            )}
          {availableModels.length > 0 && (
            <Box className="py-1">
              {renderGroupedModels(availableModels, (model) => {
                const isActive = !onlineEnabled && currentModelId === model.id;
                const languages = parseLanguageKeys(model.id);
                const languageLabel =
                  languages.length === 0
                    ? t("settings.asrModels.languages.other")
                    : languages
                      .map((k) => t(`settings.asrModels.languages.${k}`))
                      .join(" · ");
                const featureLabel = getFeatureTags(model).join(" · ");
                const meta = [languageLabel, featureLabel]
                  .filter(Boolean)
                  .join(" · ");
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
                    className={`w-full px-4 py-2.5 text-left hover:bg-mid-gray/5 transition-all cursor-pointer focus:outline-none border-l-2 group ${isActive
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
                        <Text
                          className="text-xs text-text/50 block leading-tight"
                          size="1"
                        >
                          {meta}
                        </Text>
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
                <IconCloud className="w-3.5 h-3.5" />,
                t("modelSelector.onlineAsrModels"),
                asrModels.length,
              )}
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
                      className={`w-full px-4 py-2.5 text-left transition-all cursor-pointer focus:outline-none hover:bg-mid-gray/5 border-l-2 ${isActive
                        ? "bg-logo-primary/5 border-logo-primary"
                        : "border-transparent"
                        }`}
                      data-asr-row
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
                          {isActive && realtimeEnabled && selectedRealtimeName ? (
                            <Text size="1" className="text-text/45">
                              {t("modelSelector.realtimeModel.selected", {
                                modelName: selectedRealtimeName,
                              })}
                            </Text>
                          ) : null}
                        </Box>
                        <Flex align="center" gap="2" className="flex-shrink-0 ml-3">
                          <Box className="w-5 h-5 flex items-center justify-center">
                            {isActive ? (
                              <IconCheck className="text-logo-primary w-5 h-5" />
                            ) : null}
                          </Box>
                          <IconButton
                            size="1"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAsrModelSelect(model.id, { keepOpen: true });

                              const rowEl = (e.currentTarget as HTMLElement).closest(
                                "[data-asr-row]",
                              ) as HTMLElement | null;
                              const containerEl = containerRef.current;
                              if (!rowEl || !containerEl) {
                                setRealtimePicker({
                                  asrId: model.id,
                                  style: { top: 0 },
                                });
                                return;
                              }
                              const rowRect = rowEl.getBoundingClientRect();
                              const containerRect =
                                containerEl.getBoundingClientRect();

                              // Determine if we should align to top or bottom based on position in container
                              const relativeTop = rowRect.top - containerRect.top;
                              const relativeBottom =
                                containerRect.bottom - rowRect.bottom;
                              const isLowerHalf =
                                relativeTop > containerRect.height / 2;

                              if (isLowerHalf) {
                                setRealtimePicker({
                                  asrId: model.id,
                                  style: { bottom: Math.max(0, relativeBottom) },
                                });
                              } else {
                                setRealtimePicker({
                                  asrId: model.id,
                                  style: { top: Math.max(0, relativeTop) },
                                });
                              }
                            }}
                            aria-label={t("modelSelector.realtimeModel.open")}
                          >
                            <IconChevronRight className="w-4 h-4" />
                          </IconButton>
                        </Flex>
                      </Flex>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

          {/* Downloadable Models */}
          {downloadableModels.length > 0 &&
            renderSectionHeader(
              <IconDownload className="w-3.5 h-3.5" />,
              t("modelSelector.downloadModels"),
              downloadableModels.length,
            )}
          {downloadableModels.length > 0 && (
            <Box className="py-1 bg-mid-gray/5 border-t border-mid-gray/10">
              {renderGroupedModels(downloadableModels, (model) => {
                const isDownloading = downloadProgress.has(model.id);
                const progress = downloadProgress.get(model.id);
                const languages = parseLanguageKeys(model.id);
                const languageLabel =
                  languages.length === 0
                    ? t("settings.asrModels.languages.other")
                    : languages
                      .map((k) => t(`settings.asrModels.languages.${k}`))
                      .join(" · ");
                const featureLabel = getFeatureTags(model).join(" · ");
                const meta = [languageLabel, featureLabel]
                  .filter(Boolean)
                  .join(" · ");

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
                        <Text
                          className="text-xs text-text/50 block leading-tight"
                          size="1"
                        >
                          {meta}
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

      {realtimePicker ? (
        <Box
          className="absolute left-full ml-2 w-[22rem] bg-background/95 backdrop-blur-sm border border-mid-gray/20 rounded-xl shadow-2xl shadow-black/20 overflow-hidden z-50 origin-left"
          style={realtimePicker.style}
          onMouseDown={(e) => e.stopPropagation()}
          ref={panelRef}
        >
          <Box className="px-3 py-2 border-b border-mid-gray/15 flex items-center justify-between">
            <Text size="1" className="text-text/60 uppercase tracking-wider">
              {t("modelSelector.realtimeModel.title")}
            </Text>
            <Flex align="center" gap="2">
              <Text size="1" className="text-text/40">
                {realtimeEnabled && selectedRealtimeModelId
                  ? t("modelSelector.realtimeModel.enabled")
                  : t("modelSelector.realtimeModel.off")}
              </Text>
              <IconButton
                size="1"
                variant="ghost"
                onClick={() => setRealtimePicker(null)}
                aria-label={t("common.close")}
              >
                <IconX className="w-4 h-4" />
              </IconButton>
            </Flex>
          </Box>

          <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 360 }}>
            <Box className="py-1">
              <Box
                onClick={() => {
                  onRealtimeModelSelect(null);
                  setRealtimePicker(null);
                }}
                role="button"
                tabIndex={0}
                className={`w-full px-3 py-2 text-left hover:bg-mid-gray/5 transition-all cursor-pointer border-l-2 ${selectedRealtimeModelId == null
                  ? "bg-logo-primary/5 border-logo-primary"
                  : "border-transparent"
                  }`}
              >
                <Flex justify="between" align="center">
                  <Box>
                    <Text size="2" weight="medium">
                      {t("modelSelector.realtimeModel.off")}
                    </Text>
                    <Text size="1" className="text-text/45">
                      {t("modelSelector.realtimeModel.offHint")}
                    </Text>
                  </Box>
                  <Box className="w-5 h-5 flex items-center justify-center flex-shrink-0 ml-3">
                    {selectedRealtimeModelId == null ? (
                      <IconCheck className="text-logo-primary w-5 h-5" />
                    ) : null}
                  </Box>
                </Flex>
              </Box>

              {realtimeModels.length === 0 ? (
                <Box className="px-3 py-2">
                  <Text size="1" className="text-text/50">
                    {t("modelSelector.realtimeModel.empty")}
                  </Text>
                </Box>
              ) : (
                realtimeModels.map((m) => {
                  const isActive = selectedRealtimeModelId === m.id;
                  return (
                    <Box
                      key={m.id}
                      onClick={() => {
                        onRealtimeModelSelect(m.id);
                        setRealtimePicker(null);
                      }}
                      role="button"
                      tabIndex={0}
                      className={`w-full px-3 py-2 text-left hover:bg-mid-gray/5 transition-all cursor-pointer border-l-2 ${isActive
                        ? "bg-logo-primary/5 border-logo-primary"
                        : "border-transparent"
                        }`}
                    >
                      <Flex justify="between" align="center">
                        <Box>
                          <Flex align="center" gap="2" mb="1">
                            <Text size="2" weight="medium">
                              {getTranslatedModelName(m, t)}
                            </Text>
                            <Text
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-mid-gray/10 text-text/60 font-medium"
                              size="1"
                            >
                              {formatModelSize(m.size_mb)}
                            </Text>
                          </Flex>
                          <Text size="1" className="text-text/45">
                            {getFeatureTags(m).join(" · ")}
                          </Text>
                        </Box>
                        <Box className="w-5 h-5 flex items-center justify-center flex-shrink-0 ml-3">
                          {isActive ? (
                            <IconCheck className="text-logo-primary w-5 h-5" />
                          ) : null}
                        </Box>
                      </Flex>
                    </Box>
                  );
                })
              )}
            </Box>
          </ScrollArea>
        </Box>
      ) : null}
    </Box>
  );
};

export default ModelDropdown;
