import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface ModelSpeedStats {
  model_id: string;
  provider: string;
  call_type: string;
  avg_speed: number;
  total_calls: number;
  total_errors: number;
}

export function useModelSpeedStats() {
  const [stats, setStats] = useState<ModelSpeedStats[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<ModelSpeedStats[]>("get_model_speed_stats");
      setStats(data);
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

      return { totalCalls, totalErrors, avgSpeed };
    },
    [getStatsForModel],
  );

  return { stats, loading, refresh, getStatsForModel, getAggregatedStats };
}
