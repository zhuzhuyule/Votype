import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ModelInfo } from "../../lib/types";
import DownloadProgressDisplay from "./DownloadProgressDisplay";
import ModelDropdown from "./ModelDropdown";
import ModelStatusButton from "./ModelStatusButton";

interface ModelStateEvent {
  event_type: string;
  model_id?: string;
  model_name?: string;
  error?: string;
}

interface DownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface DownloadStats {
  startTime: number;
  lastUpdate: number;
  totalDownloaded: number;
  speed: number;
}

interface ModelSelectorProps {
  onError?: (error: string) => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ onError }) => {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string>("");
  const [modelStatus, setModelStatus] = useState<ModelStatus>("unloaded");
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<
    Map<string, DownloadProgress>
  >(new Map());
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [downloadStats, setDownloadStats] = useState<
    Map<string, DownloadStats>
  >(new Map());
  const [extractingModels, setExtractingModels] = useState<Set<string>>(
    new Set(),
  );
  const { settings, selectAsrModel, toggleOnlineAsr, updateSetting } =
    useSettings();

  const cachedModels = settings?.cached_models || [];
  const providerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers.forEach((provider) => {
      map[provider.id] = provider.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  const asrModels = useMemo(
    () =>
      cachedModels
        .filter((model) => model.model_type === "asr")
        .map((model) => ({
          id: model.id,
          name: model.name,
          providerLabel:
            providerNameMap[model.provider_id] ?? model.provider_id,
        })),
    [cachedModels, providerNameMap],
  );

  const selectedAsrModel = useMemo(
    () =>
      cachedModels.find(
        (model) =>
          model.model_type === "asr" &&
          model.id === settings?.selected_asr_model_id,
      ) ?? null,
    [cachedModels, settings?.selected_asr_model_id],
  );

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadModels();
    loadCurrentModel();

    // Listen for model state changes
    const modelStateUnlisten = listen<ModelStateEvent>(
      "model-state-changed",
      (event) => {
        const { event_type, model_id, model_name, error } = event.payload;

        switch (event_type) {
          case "loading_started":
            setModelStatus("loading");
            setModelError(null);
            break;
          case "loading_completed":
            setModelStatus("ready");
            setModelError(null);
            if (model_id) setCurrentModelId(model_id);
            break;
          case "loading_failed":
            setModelStatus("error");
            setModelError(error || t("modelSelector.modelError"));
            break;
          case "unloaded":
            setModelStatus("unloaded");
            setModelError(null);
            break;
        }
      },
    );

    // Listen for model download progress
    const downloadProgressUnlisten = listen<DownloadProgress>(
      "model-download-progress",
      (event) => {
        const progress = event.payload;
        setModelDownloadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.set(progress.model_id, progress);
          return newMap;
        });
        setModelStatus("downloading");

        // Update download stats for speed calculation
        const now = Date.now();
        setDownloadStats((prev) => {
          const current = prev.get(progress.model_id);
          const newStats = new Map(prev);

          if (!current) {
            // First progress update - initialize
            newStats.set(progress.model_id, {
              startTime: now,
              lastUpdate: now,
              totalDownloaded: progress.downloaded,
              speed: 0,
            });
          } else {
            // Calculate speed over last few seconds
            const timeDiff = (now - current.lastUpdate) / 1000; // seconds
            const bytesDiff = progress.downloaded - current.totalDownloaded;

            if (timeDiff > 0.5) {
              // Update speed every 500ms
              const currentSpeed = bytesDiff / (1024 * 1024) / timeDiff; // MB/s
              // Smooth the speed with exponential moving average, but ensure positive values
              const validCurrentSpeed = Math.max(0, currentSpeed);
              const smoothedSpeed =
                current.speed > 0
                  ? current.speed * 0.8 + validCurrentSpeed * 0.2
                  : validCurrentSpeed;

              newStats.set(progress.model_id, {
                startTime: current.startTime,
                lastUpdate: now,
                totalDownloaded: progress.downloaded,
                speed: Math.max(0, smoothedSpeed),
              });
            }
          }

          return newStats;
        });
      },
    );

    // Listen for model download completion
    const downloadCompleteUnlisten = listen<string>(
      "model-download-complete",
      (event) => {
        const modelId = event.payload;
        setModelDownloadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.delete(modelId);
          return newMap;
        });
        setDownloadStats((prev) => {
          const newStats = new Map(prev);
          newStats.delete(modelId);
          return newStats;
        });
        loadModels(); // Refresh models list

        // Auto-select the newly downloaded model (skip if recording in progress)
        setTimeout(async () => {
          const isRecording = await invoke<boolean>("is_recording");
          if (isRecording) {
            return; // Skip auto-switch if recording in progress
          }
          loadCurrentModel();
          handleModelSelect(modelId);
        }, 500);
      },
    );

    // Listen for extraction events
    const extractionStartedUnlisten = listen<string>(
      "model-extraction-started",
      (event) => {
        const modelId = event.payload;
        setExtractingModels((prev) => new Set(prev.add(modelId)));
        setModelStatus("extracting");
      },
    );

    const extractionCompletedUnlisten = listen<string>(
      "model-extraction-completed",
      (event) => {
        const modelId = event.payload;
        setExtractingModels((prev) => {
          const next = new Set(prev);
          next.delete(modelId);
          return next;
        });
        loadModels(); // Refresh models list

        // Auto-select the newly extracted model (skip if recording in progress)
        setTimeout(async () => {
          const isRecording = await invoke<boolean>("is_recording");
          if (isRecording) {
            return; // Skip auto-switch if recording in progress
          }
          loadCurrentModel();
          handleModelSelect(modelId);
        }, 500);
      },
    );

    const extractionFailedUnlisten = listen<{
      model_id: string;
      error: string;
    }>("model-extraction-failed", (event) => {
      const modelId = event.payload.model_id;
      setExtractingModels((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      setModelError(`Failed to extract model: ${event.payload.error}`);
      setModelStatus("error");
    });

    // Click outside to close dropdown
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowModelDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      modelStateUnlisten.then((fn) => fn());
      downloadProgressUnlisten.then((fn) => fn());
      downloadCompleteUnlisten.then((fn) => fn());
      extractionStartedUnlisten.then((fn) => fn());
      extractionCompletedUnlisten.then((fn) => fn());
      extractionFailedUnlisten.then((fn) => fn());
    };
  }, []);

  const loadModels = async () => {
    try {
      const modelList = await invoke<ModelInfo[]>("get_available_models");
      setModels(modelList);
    } catch (err) {
      console.error("Failed to load available models", err);
    }
  };

  const loadCurrentModel = async () => {
    try {
      const current = await invoke<string>("get_current_model");
      setCurrentModelId(current);

      if (current) {
        // Check if model is actually loaded
        const transcriptionStatus = await invoke<string | null>(
          "get_transcription_model_status",
        );
        if (transcriptionStatus === current) {
          setModelStatus("ready");
        } else {
          setModelStatus("unloaded");
        }
      } else {
        setModelStatus("none");
      }
    } catch (err) {
      console.error("Failed to load current model", err);
      setModelStatus("error");
      setModelError(t("modelSelector.modelError"));
    }
  };

  const handleModelSelect = async (modelId: string) => {
    try {
      setModelError(null);
      setShowModelDropdown(false);
      if (settings?.online_asr_enabled) {
        await toggleOnlineAsr(false);
      }
      await invoke("set_active_model", { modelId });
      setCurrentModelId(modelId);
    } catch (err) {
      const errorMsg = `${err}`;
      setModelError(errorMsg);
      setModelStatus("error");
      onError?.(errorMsg);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    try {
      setModelError(null);
      await invoke("download_model", { modelId });
    } catch (err) {
      const errorMsg = `${err}`;
      setModelError(errorMsg);
      setModelStatus("error");
      onError?.(errorMsg);
    }
  };

  const getCurrentModel = () => {
    return models.find((m) => m.id === currentModelId);
  };

  const getModelDisplayText = (): string => {
    if (extractingModels.size > 0) {
      if (extractingModels.size === 1) {
        const [modelId] = Array.from(extractingModels);
        const model = models.find((m) => m.id === modelId);
        return model?.name
          ? t("modelSelector.extracting", { modelName: model.name })
          : t("modelSelector.extractingGeneric");
      } else {
        return t("modelSelector.extractingMultiple", {
          count: extractingModels.size,
        });
      }
    }

    if (modelDownloadProgress.size > 0) {
      if (modelDownloadProgress.size === 1) {
        const [progress] = Array.from(modelDownloadProgress.values());
        const percentage = Math.max(
          0,
          Math.min(100, Math.round(progress.percentage)),
        );
        return t("modelSelector.downloading", { percentage });
      } else {
        return t("modelSelector.downloadingMultiple", {
          count: modelDownloadProgress.size,
        });
      }
    }

    const onlineActive =
      settings?.online_asr_enabled && selectedAsrModel !== null;
    const onlineLabel = onlineActive
      ? selectedAsrModel?.name || t("modelSelector.onlineAsr")
      : null;
    const currentModel = getCurrentModel();

    if (onlineActive) {
      return onlineLabel || t("modelSelector.onlineAsr");
    }

    switch (modelStatus) {
      case "ready":
        return currentModel?.name || t("modelSelector.modelReady");
      case "loading":
        return currentModel
          ? t("modelSelector.loading", { modelName: currentModel.name })
          : t("modelSelector.loadingGeneric");
      case "extracting":
        return currentModel
          ? t("modelSelector.extracting", { modelName: currentModel.name })
          : t("modelSelector.extractingGeneric");
      case "error":
        return modelError || t("modelSelector.modelError");
      case "unloaded":
        return currentModel?.name || t("modelSelector.modelUnloaded");
      case "none":
        return t("modelSelector.noModelDownloadRequired");
      default:
        return currentModel?.name || t("modelSelector.modelUnloaded");
    }
  };

  const handleAsrModelSelect = async (
    modelId: string,
    opts?: { keepOpen?: boolean },
  ) => {
    try {
      if (!settings?.online_asr_enabled) {
        await toggleOnlineAsr(true);
      }
      if (!opts?.keepOpen) {
        setShowModelDropdown(false);
      }
      await selectAsrModel(modelId);
    } catch (err) {
      const errorMsg = `${err}`;
      setModelError(errorMsg);
      setModelStatus("error");
      onError?.(errorMsg);
    }
  };

  const modeLabel =
    settings?.online_asr_enabled && settings?.selected_asr_model_id
      ? t("modelSelector.online")
      : t("modelSelector.local");
  const modeLabelColor =
    settings?.online_asr_enabled && settings?.selected_asr_model_id
      ? "text-blue-700 bg-blue-50 border border-blue-200"
      : "text-emerald-600 bg-emerald-50 border border-emerald-200";

  const favoriteModels = useMemo(
    () => new Set(settings?.favorite_transcription_models ?? []),
    [settings?.favorite_transcription_models],
  );

  const modelsForQuickSelector = useMemo(() => {
    const selectable = models.filter(
      (m) => m.engine_type !== "SherpaOnnxPunctuation",
    );

    const base =
      favoriteModels.size === 0
        ? (() => {
            const downloaded = selectable.filter((m) => m.is_downloaded);
            return downloaded.length > 0 ? downloaded : selectable;
          })()
        : selectable.filter(
            (m) => favoriteModels.has(m.id) || m.id === currentModelId,
          );

    const withCurrent =
      currentModelId && !base.some((m) => m.id === currentModelId)
        ? [...base, ...selectable.filter((m) => m.id === currentModelId)]
        : base;

    return withCurrent.slice().sort((a, b) => {
      if (a.id === currentModelId) return -1;
      if (b.id === currentModelId) return 1;
      if (a.is_downloaded !== b.is_downloaded) return a.is_downloaded ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [models, favoriteModels, currentModelId]);

  const realtimeModelsForQuickSelector = useMemo(() => {
    const sherpaDownloaded = models.filter(
      (m) =>
        m.is_downloaded &&
        m.engine_type === "SherpaOnnx" &&
        Boolean(m.sherpa) &&
        m.id !== currentModelId,
    );

    const selectedRealtimeId = settings?.post_process_secondary_model_id ?? null;
    const ensureSelected =
      selectedRealtimeId && !sherpaDownloaded.some((m) => m.id === selectedRealtimeId)
        ? sherpaDownloaded.filter((m) => m.id === selectedRealtimeId)
        : [];

    const list = [...sherpaDownloaded, ...ensureSelected];
    return list
      .filter(
        (m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx,
      )
      .sort((a, b) => {
        const fa = favoriteModels.has(a.id);
        const fb = favoriteModels.has(b.id);
        if (fa !== fb) return fa ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [models, favoriteModels, currentModelId, settings?.post_process_secondary_model_id]);

  return (
    <>
      {/* Model Status and Switcher */}
      <div className="relative" ref={dropdownRef}>
        <ModelStatusButton
          status={modelStatus}
          displayText={getModelDisplayText()}
          isDropdownOpen={showModelDropdown}
          onClick={() => setShowModelDropdown(!showModelDropdown)}
          modeLabel={modeLabel}
          modeLabelColor={modeLabelColor}
          isOnlineModel={
            settings?.online_asr_enabled && !!settings?.selected_asr_model_id
          }
        />

        {/* Model Dropdown */}
        {showModelDropdown && (
          <ModelDropdown
            models={modelsForQuickSelector}
            currentModelId={currentModelId}
            downloadProgress={modelDownloadProgress}
            onModelSelect={handleModelSelect}
            onModelDownload={handleModelDownload}
            asrModels={asrModels}
            selectedAsrModelId={settings?.selected_asr_model_id || null}
            onAsrModelSelect={handleAsrModelSelect}
            onlineEnabled={settings?.online_asr_enabled || false}
            realtimeModels={realtimeModelsForQuickSelector}
            selectedRealtimeModelId={settings?.post_process_secondary_model_id ?? null}
            realtimeEnabled={settings?.post_process_use_secondary_output || false}
            onRealtimeModelSelect={async (modelId) => {
              await updateSetting("post_process_secondary_model_id", modelId);
              await updateSetting("post_process_use_secondary_output", Boolean(modelId));
            }}
          />
        )}
      </div>

      {/* Download Progress Bar for Models */}
      <DownloadProgressDisplay
        downloadProgress={modelDownloadProgress}
        downloadStats={downloadStats}
      />
    </>
  );
};

export default ModelSelector;
