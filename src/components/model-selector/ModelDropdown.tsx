import { Box, Flex, IconButton, ScrollArea, Text } from "@radix-ui/themes";
import {
  IconCheck,
  IconChevronRight,
  IconCloud,
  IconCloudUpload,
  IconCube,
  IconDeviceDesktop,
  IconDownload,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { formatModelSize } from "../../lib/utils/format";
import { getTranslatedModelName } from "../../lib/utils/modelTranslation";
import { ProgressBar } from "../shared";
import { ModelGroupHeader } from "./ModelGroupHeader";
import { ModelListItem } from "./ModelListItem";

const RECOMMENDED_MODEL_IDS = new Set([
  "sherpa-zipformer-small-ctc-zh-int8-2025-04-01",
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

    // Add Architecture tag
    if (m.engine_type === "Whisper") {
      tags.push("Whisper");
    } else if (m.engine_type === "Parakeet") {
      tags.push("Parakeet");
    } else if (m.engine_type === "SherpaOnnx") {
      if (m.sherpa?.family) {
        tags.push(m.sherpa.family);
      }
    }

    if (id.includes("int8")) tags.push("INT8");
    if (id.includes("trilingual")) tags.push("Trilingual");
    if (id.includes("bilingual")) tags.push("Bilingual");

    return tags;
  };

  const getCategory = React.useCallback(
    (model: ModelInfo) => {
      if (model.engine_type === "SherpaOnnxPunctuation")
        return t("settings.asrModels.groups.punctuation");

      const isStreaming =
        model.engine_type === "SherpaOnnx" &&
        model.sherpa?.mode === "Streaming";

      return isStreaming
        ? t("settings.asrModels.groups.streaming")
        : t("settings.asrModels.groups.offline");
    },
    [t],
  );

  const orderCategory = (category: string) => {
    if (category === t("settings.asrModels.groups.streaming")) return 0;
    if (category === t("settings.asrModels.groups.offline")) return 1;
    return 2;
  };

  const availableModels = models
    .filter((m) => m.is_downloaded)
    .sort((a, b) => {
      const catA = getCategory(a);
      const catB = getCategory(b);
      const orderA = orderCategory(catA);
      const orderB = orderCategory(catB);

      if (orderA !== orderB) return orderA - orderB;
      if (a.id === currentModelId) return -1;
      if (b.id === currentModelId) return 1;
      return a.name.localeCompare(b.name);
    });

  const downloadableModels = models
    .filter((m) => !m.is_downloaded)
    .sort((a, b) => {
      const catA = getCategory(a);
      const catB = getCategory(b);
      const orderA = orderCategory(catA);
      const orderB = orderCategory(catB);

      if (orderA !== orderB) return orderA - orderB;
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

  const renderGroupedModels = (
    list: ModelInfo[],
    renderItem: (m: ModelInfo) => React.ReactNode,
  ) => {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of list) {
      const key = getCategory(model);
      const arr = groups.get(key) ?? [];
      arr.push(model);
      groups.set(key, arr);
    }
    const ordered = Array.from(groups.entries()).sort(
      ([a], [b]) => orderCategory(a) - orderCategory(b),
    );
    return (
      <Flex direction="column" gap="0">
        {ordered.map(([category, items]) => {
          const isStreaming =
            category === t("settings.asrModels.groups.streaming");
          const isMultilingual =
            category === t("settings.asrModels.groups.multilingual");
          const isPunctuation =
            category === t("settings.asrModels.groups.punctuation");

          let headerClass = "text-text/70 bg-mid-gray/5 dark:bg-gray-900/40";
          if (isStreaming) {
            headerClass =
              "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20!";
          } else if (isMultilingual) {
            headerClass =
              "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30";
          } else if (isPunctuation) {
            headerClass =
              "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30";
          } else {
            // Default offline
            headerClass =
              "text-stone-600 dark:text-stone-300 bg-stone-50 dark:bg-stone-800/50";
          }

          return (
            <Box key={category}>
              <ModelGroupHeader
                label={category}
                count={items.length}
                className={headerClass}
                icon={
                  isStreaming ? (
                    <IconCloudUpload className="w-3 h-3" />
                  ) : (
                    <IconDeviceDesktop className="w-3 h-3" />
                  )
                }
              />
              <Box className="divide-y divide-black/5">
                {items.map(renderItem)}
              </Box>
            </Box>
          );
        })}
      </Flex>
    );
  };

  return (
    <Box
      ref={containerRef}
      style={{ borderRadius: "var(--radius-5)" }}
      className="absolute bottom-full left-0 mb-2 w-[32rem] max-h-[70vh] bg-background/95 backdrop-blur-sm border border-mid-gray/20 shadow-2xl z-50 shadow-black/20 overflow-visible animate-in fade-in zoom-in-95 duration-200 origin-bottom-left"
    >
      <Box
        className="overflow-hidden"
        style={{ borderRadius: "var(--radius-5)" }}
      >
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

        <ScrollArea
          type="hover"
          scrollbars="vertical"
          className="max-h-[60vh] group"
        >
          <Box className="pr-0 transition-[padding-right] duration-200 group-has-[div[data-orientation=vertical][data-state=visible]]:pr-3">
            {/* Downloaded Models */}
            {availableModels.length > 0 &&
              renderGroupedModels(availableModels, (model) => {
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
                  <ModelListItem
                    key={model.id}
                    name={getTranslatedModelName(model, t)}
                    meta={meta}
                    size={formatModelSize(model.size_mb)}
                    isRecommended={RECOMMENDED_MODEL_IDS.has(model.id)}
                    isActive={isActive}
                    onClick={() => handleModelClick(model.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleModelClick(model.id);
                      }
                    }}
                    rightElement={
                      isActive ? (
                        <IconCheck className="text-logo-primary w-5 h-5 flex-shrink-0" />
                      ) : null
                    }
                  />
                );
              })}

            {/* Online ASR Models */}

            {asrModels.length > 0 && (
              <Box className="overflow-hidden">
                <ModelGroupHeader
                  icon={<IconCloud className="w-3 h-3" />}
                  label={t("modelSelector.onlineAsrModels")}
                  count={asrModels.length}
                  className="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                />

                <Box className="divide-y divide-black/5">
                  {asrModels.map((model) => {
                    const isActive =
                      onlineEnabled && selectedAsrModelId === model.id;

                    return (
                      <ModelListItem
                        key={model.id}
                        name={model.name}
                        isActive={isActive}
                        onClick={() => onAsrModelSelect(model.id)}
                        data-asr-row
                        children={
                          <Text
                            style={{ borderRadius: "var(--radius-3)" }}
                            className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 font-medium border border-blue-100 flex-shrink-0"
                            size="1"
                          >
                            {model.providerLabel}
                          </Text>
                        }
                        meta={
                          isActive &&
                          realtimeEnabled &&
                          selectedRealtimeName ? (
                            <Text size="1" className="text-text/45">
                              {t("modelSelector.realtimeModel.selected", {
                                modelName: selectedRealtimeName,
                              })}
                            </Text>
                          ) : null
                        }
                        rightElement={
                          <Flex align="center" gap="2">
                            <Box className="w-5 h-5 flex items-center justify-center">
                              {isActive && (
                                <IconCheck className="text-logo-primary w-5 h-5" />
                              )}
                            </Box>
                            <IconButton
                              size="1"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAsrModelSelect(model.id, { keepOpen: true });

                                const rowEl = (
                                  e.currentTarget as HTMLElement
                                ).closest(
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
                                const relativeTop =
                                  rowRect.top - containerRect.top;
                                const relativeBottom =
                                  containerRect.bottom - rowRect.bottom;
                                const isLowerHalf =
                                  relativeTop > containerRect.height / 2;

                                if (isLowerHalf) {
                                  setRealtimePicker({
                                    asrId: model.id,
                                    style: {
                                      bottom: Math.max(0, relativeBottom),
                                    },
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
                        }
                      />
                    );
                  })}
                </Box>
              </Box>
            )}

            {/* Downloadable Models */}
            {downloadableModels.length > 0 &&
              renderGroupedModels(downloadableModels, (model) => {
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
                  <ModelListItem
                    key={model.id}
                    name={getTranslatedModelName(model, t)}
                    meta={meta}
                    size={formatModelSize(model.size_mb)}
                    isRecommended={RECOMMENDED_MODEL_IDS.has(model.id)}
                    onClick={(e) => {
                      // Prevent click if downloading? Original logic checked this:
                      // if (downloadProgress.has(modelId)) return;
                      // But here we rely on the component. I should maybe disable pointer events or check inside handler.
                      // The original `handleDownloadClick` checked progress.
                      // The Row `onClick` handled selection, `IconButton` handled download.
                      // Actually, for Downloadable models, the row click usually triggers selection (which triggers download? No).
                      // Wait, `downloadableModels` are not selected. Clicking them usually does nothing or ...?
                      // Original code: `className="... hover:bg-mid-gray/5 ... cursor-pointer"`
                      // But `onClick` wasn't mapped?
                      // Original code for downloadable models:
                      // `className="... hover:bg-mid-gray/5 ..."` but NO onClick handler on the Box except bubbling?
                      // Wait! The original code (lines 553-639) definitely had `Box` representing the row.
                      // BUT it had NO `onClick` prop!
                      // So user couldn't click the row to do anything?
                      // But it had `IconButton` with `handleDownloadClick`.
                      // So `ModelListItem` onClick should optionally be undefined.
                    }}
                    className={
                      isDownloading ? "cursor-default" : "cursor-default"
                    } // They weren't clickable as rows?
                    rightElement={
                      isDownloading && progress ? (
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
                          className="hover:bg-logo-primary/10 text-logo-primary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                          title={t("modelSelector.download")}
                        >
                          <IconDownload className="w-4 h-4" />
                        </IconButton>
                      )
                    }
                  />
                );
              })}

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
          </Box>
        </ScrollArea>
      </Box>

      {realtimePicker ? (
        <Box
          className="absolute left-full ml-2 w-[32rem] bg-background/95 backdrop-blur-sm border border-mid-gray/20 shadow-2xl shadow-black/20 overflow-hidden z-50 origin-left"
          style={{
            ...realtimePicker.style,
            borderRadius: "var(--radius-5)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          ref={panelRef}
        >
          <Box className="px-3 py-2 border-b border-mid-gray/15 flex items-center justify-between">
            <Text size="1" className="text-text/60 uppercase tracking-wider">
              {t("modelSelector.realtimeModel.title")}
            </Text>
          </Box>

          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ maxHeight: 360 }}
            className="group"
          >
            <Flex
              direction="column"
              gap="0"
              className="pr-0 transition-[padding-right] duration-200 group-has-[div[data-orientation=vertical][data-state=visible]]:pr-3"
            >
              <ModelListItem
                name={t("modelSelector.realtimeModel.off")}
                meta={t("modelSelector.realtimeModel.offHint")}
                isActive={selectedRealtimeModelId == null}
                onClick={() => {
                  onRealtimeModelSelect(null);
                  setRealtimePicker(null);
                }}
                rightElement={
                  selectedRealtimeModelId == null ? (
                    <IconCheck className="text-logo-primary w-5 h-5 flex-shrink-0" />
                  ) : null
                }
              />

              {realtimeModels.length === 0 ? (
                <Box className="px-3 py-2">
                  <Text size="1" className="text-text/50">
                    {t("modelSelector.realtimeModel.empty")}
                  </Text>
                </Box>
              ) : (
                renderGroupedModels(
                  [...realtimeModels].sort((a, b) => {
                    const diff = a.size_mb - b.size_mb;
                    if (diff !== 0) return diff;
                    const aRec = RECOMMENDED_MODEL_IDS.has(a.id);
                    const bRec = RECOMMENDED_MODEL_IDS.has(b.id);
                    if (aRec !== bRec) return aRec ? -1 : 1;
                    return 0;
                  }),
                  (m) => {
                    const isActive = selectedRealtimeModelId === m.id;
                    const isRecommended = RECOMMENDED_MODEL_IDS.has(m.id);
                    return (
                      <ModelListItem
                        key={m.id}
                        name={getTranslatedModelName(m, t)}
                        size={formatModelSize(m.size_mb)}
                        meta={getFeatureTags(m).join(" · ")}
                        isActive={isActive}
                        isRecommended={isRecommended}
                        onClick={() => {
                          onRealtimeModelSelect(m.id);
                          setRealtimePicker(null);
                        }}
                        rightElement={
                          isActive ? (
                            <IconCheck className="text-logo-primary w-5 h-5 flex-shrink-0" />
                          ) : null
                        }
                      />
                    );
                  },
                )
              )}
            </Flex>
          </ScrollArea>
        </Box>
      ) : null}
    </Box>
  );
};

export default ModelDropdown;
