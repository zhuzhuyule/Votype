import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface AsrModelUsage {
  asr_model: string;
  use_count: number;
  last_used: number | null;
}

export function useAsrModelUsage() {
  const [usage, setUsage] = useState<AsrModelUsage[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUsage(await invoke<AsrModelUsage[]>("get_asr_model_usage"));
    } catch (e) {
      console.error("Failed to fetch ASR model usage:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getUsage = useCallback(
    (modelId: string) => usage.find((u) => u.asr_model === modelId) ?? null,
    [usage],
  );

  return { usage, loading, refresh, getUsage };
}
