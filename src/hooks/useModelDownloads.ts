/**
 * useModelDownloads - Shared hook for model download/extraction event handling
 *
 * This hook centralizes all model download and extraction event listeners
 * to avoid duplication between useModels.ts and ModelSelector.tsx
 */

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import {
  DOWNLOAD_COMPLETED,
  DOWNLOAD_PROGRESS,
  EXTRACTION_COMPLETED,
  EXTRACTION_FAILED,
  EXTRACTION_STARTED,
  MODEL_STATE_CHANGED,
} from "../lib/events";
import type {
  DownloadProgress,
  DownloadStats,
  ModelStateEvent,
  ModelStatus,
} from "../lib/types";

export interface UseModelDownloadsReturn {
  // Download state
  downloadingModels: Set<string>;
  downloadProgress: Map<string, DownloadProgress>;
  downloadStats: Map<string, DownloadStats>;

  // Extraction state
  extractingModels: Set<string>;

  // Model state
  modelStatus: ModelStatus;
  modelError: string | null;

  // Callbacks for external handling
  onDownloadComplete?: (modelId: string) => void;
  onExtractionComplete?: (modelId: string) => void;
  onModelStateChange?: (event: ModelStateEvent) => void;
}

interface UseModelDownloadsOptions {
  onDownloadComplete?: (modelId: string) => void;
  onExtractionComplete?: (modelId: string) => void;
  onModelStateChange?: (event: ModelStateEvent) => void;
  onError?: (error: string) => void;
}

export const useModelDownloads = (
  options: UseModelDownloadsOptions = {},
): UseModelDownloadsReturn => {
  const {
    onDownloadComplete,
    onExtractionComplete,
    onModelStateChange,
    onError,
  } = options;

  // Download state
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(
    new Set(),
  );
  const [downloadProgress, setDownloadProgress] = useState<
    Map<string, DownloadProgress>
  >(new Map());
  const [downloadStats, setDownloadStats] = useState<
    Map<string, DownloadStats>
  >(new Map());

  // Extraction state
  const [extractingModels, setExtractingModels] = useState<Set<string>>(
    new Set(),
  );

  // Model state
  const [modelStatus, setModelStatus] = useState<ModelStatus>("unloaded");
  const [modelError, setModelError] = useState<string | null>(null);

  // Mark a model as downloading
  const startDownload = useCallback((modelId: string) => {
    setDownloadingModels((prev) => new Set(prev.add(modelId)));
  }, []);

  // Clear download state for a model
  const clearDownload = useCallback((modelId: string) => {
    setDownloadingModels((prev) => {
      const next = new Set(prev);
      next.delete(modelId);
      return next;
    });
    setDownloadProgress((prev) => {
      const next = new Map(prev);
      next.delete(modelId);
      return next;
    });
    setDownloadStats((prev) => {
      const next = new Map(prev);
      next.delete(modelId);
      return next;
    });
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setupListeners = async () => {
      // Model state changes
      const unlistenState = await listen<ModelStateEvent>(
        MODEL_STATE_CHANGED,
        (event) => {
          const { event_type, model_id, error } = event.payload;

          switch (event_type) {
            case "loading_started":
              setModelStatus("loading");
              setModelError(null);
              break;
            case "loading_completed":
              setModelStatus("ready");
              setModelError(null);
              break;
            case "loading_failed":
              setModelStatus("error");
              setModelError(error || "Model loading failed");
              onError?.(error || "Model loading failed");
              break;
            case "unloaded":
              setModelStatus("unloaded");
              setModelError(null);
              break;
          }

          onModelStateChange?.(event.payload);
        },
      );
      unlisteners.push(unlistenState);

      // Download progress
      const unlistenProgress = await listen<DownloadProgress>(
        DOWNLOAD_PROGRESS,
        (event) => {
          const progress = event.payload;

          setDownloadProgress(
            (prev) => new Map(prev.set(progress.model_id, progress)),
          );
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
              const timeDiff = (now - current.lastUpdate) / 1000;
              const bytesDiff = progress.downloaded - current.totalDownloaded;

              if (timeDiff > 0.5) {
                const currentSpeed = bytesDiff / (1024 * 1024) / timeDiff;
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
      unlisteners.push(unlistenProgress);

      // Download complete
      const unlistenComplete = await listen<string>(
        DOWNLOAD_COMPLETED,
        (event) => {
          const modelId = event.payload;
          clearDownload(modelId);
          onDownloadComplete?.(modelId);
        },
      );
      unlisteners.push(unlistenComplete);

      // Extraction started
      const unlistenExtractionStart = await listen<string>(
        EXTRACTION_STARTED,
        (event) => {
          const modelId = event.payload;
          setExtractingModels((prev) => new Set(prev.add(modelId)));
          setModelStatus("extracting");
        },
      );
      unlisteners.push(unlistenExtractionStart);

      // Extraction completed
      const unlistenExtractionComplete = await listen<string>(
        EXTRACTION_COMPLETED,
        (event) => {
          const modelId = event.payload;
          setExtractingModels((prev) => {
            const next = new Set(prev);
            next.delete(modelId);
            return next;
          });
          onExtractionComplete?.(modelId);
        },
      );
      unlisteners.push(unlistenExtractionComplete);

      // Extraction failed
      const unlistenExtractionFailed = await listen<{
        model_id: string;
        error: string;
      }>(EXTRACTION_FAILED, (event) => {
        const { model_id, error } = event.payload;
        setExtractingModels((prev) => {
          const next = new Set(prev);
          next.delete(model_id);
          return next;
        });
        setModelError(`Failed to extract model: ${error}`);
        setModelStatus("error");
        onError?.(`Failed to extract model: ${error}`);
      });
      unlisteners.push(unlistenExtractionFailed);
    };

    setupListeners();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    onDownloadComplete,
    onExtractionComplete,
    onModelStateChange,
    onError,
    clearDownload,
  ]);

  return {
    downloadingModels,
    downloadProgress,
    downloadStats,
    extractingModels,
    modelStatus,
    modelError,
  };
};
