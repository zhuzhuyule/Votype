import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BufferStats,
  UserDecision,
  VocabularyBufferItem,
} from "../types/vocabularyBuffer";

export function useVocabularyBuffer() {
  const [items, setItems] = useState<VocabularyBufferItem[]>([]);
  const [stats, setStats] = useState<BufferStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAutoPromoting, setIsAutoPromoting] = useState(false);
  const [autoPromoteResult, setAutoPromoteResult] = useState<
    number | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);

  const loadItems = async () => {
    try {
      const data = await invoke<VocabularyBufferItem[]>(
        "get_vocabulary_buffer",
      );
      setItems(data);
      setError(null);
    } catch (err) {
      setError(`Failed to load vocabulary buffer: ${err}`);
    }
  };

  const loadStats = async () => {
    try {
      const data = await invoke<BufferStats>("get_vocabulary_buffer_stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to load vocabulary buffer stats:", err);
    }
  };

  const loadAll = async () => {
    setIsLoading(true);
    await Promise.all([loadItems(), loadStats()]);
    setIsLoading(false);
  };

  const updateDecision = async ({
    id,
    decision,
  }: {
    id: number;
    decision: UserDecision;
  }) => {
    setIsUpdating(true);
    try {
      await invoke("update_vocabulary_decision", { id, decision });
      await loadAll();
      setError(null);
      return true;
    } catch (err) {
      setError(`Failed to update decision: ${err}`);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const promote = async (id: number) => {
    setIsUpdating(true);
    try {
      await invoke("promote_vocabulary_to_hotword", { id });
      await loadAll();
      setError(null);
      return true;
    } catch (err) {
      setError(`Failed to promote vocabulary: ${err}`);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteItem = async (id: number) => {
    setIsUpdating(true);
    try {
      await invoke("delete_vocabulary_buffer_item", { id });
      await loadAll();
      setError(null);
      return true;
    } catch (err) {
      setError(`Failed to delete vocabulary: ${err}`);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const autoPromote = async ({
    minCumulative = 10,
    minDays = 3,
    minConfidence = 80,
  }: {
    minCumulative?: number;
    minDays?: number;
    minConfidence?: number;
  } = {}) => {
    setIsAutoPromoting(true);
    try {
      const count = await invoke<number>("auto_promote_vocabulary", {
        minCumulative,
        minDays,
        minConfidence,
      });
      setAutoPromoteResult(count);
      await loadAll();
      setError(null);
      return count;
    } catch (err) {
      setError(`Failed to auto-promote vocabulary: ${err}`);
      return 0;
    } finally {
      setIsAutoPromoting(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  return {
    items,
    stats,
    isLoading,
    isUpdating,
    isAutoPromoting,
    autoPromoteResult,
    error,
    updateDecision,
    promote,
    delete: deleteItem,
    autoPromote,
    reload: loadAll,
  };
}
