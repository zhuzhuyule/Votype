import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface ModelSpeedStats {
  model_id: string;
  provider: string;
  call_type: string;
  avg_speed: number;
  total_calls: number;
  total_errors: number;
  /** Client-side join from `get_model_last_errors` (latest failure for this model+provider). */
  last_error?: string | null;
  last_error_at?: string | null;
}

interface ModelLastError {
  model_id: string;
  provider: string;
  error: string;
  created_at: string;
}

export function useModelSpeedStats() {
  const [stats, setStats] = useState<ModelSpeedStats[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [data, lastErrors] = await Promise.all([
        invoke<ModelSpeedStats[]>("get_model_speed_stats"),
        invoke<ModelLastError[]>("get_model_last_errors").catch(() => []),
      ]);
      const byModel = new Map(
        lastErrors.map((e) => [`${e.model_id}\u0000${e.provider}`, e]),
      );
      setStats(
        data.map((s) => {
          const le = byModel.get(`${s.model_id}\u0000${s.provider}`);
          return le
            ? { ...s, last_error: le.error, last_error_at: le.created_at }
            : s;
        }),
      );
    } catch (e) {
      console.error("Failed to fetch model speed stats:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getStatsForModel = useCallback(
    (modelId: string, providerId?: string) => {
      return stats.filter(
        (s) =>
          s.model_id === modelId &&
          (providerId === undefined || s.provider === providerId),
      );
    },
    [stats],
  );

  const getAggregatedStats = useCallback(
    (modelId: string, providerId?: string) => {
      const matched = getStatsForModel(modelId, providerId);
      if (matched.length === 0) return null;

      const totalCalls = matched.reduce((sum, s) => sum + s.total_calls, 0);
      const totalErrors = matched.reduce(
        (sum, s) => sum + (s.total_errors ?? 0),
        0,
      );
      const weightedSpeed = matched.reduce(
        (sum, s) => sum + s.avg_speed * s.total_calls,
        0,
      );
      const avgSpeed = totalCalls > 0 ? weightedSpeed / totalCalls : 0;
      const errored = matched.find((s) => s.last_error);

      return {
        totalCalls,
        totalErrors,
        avgSpeed,
        lastError: errored?.last_error ?? null,
        lastErrorAt: errored?.last_error_at ?? null,
      };
    },
    [getStatsForModel],
  );

  return { stats, loading, refresh, getStatsForModel, getAggregatedStats };
}
