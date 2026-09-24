import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ClusterFeedback } from "../summaryTypes";

export function useClusterFeedback(clusterId: string | null) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ClusterFeedback[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!clusterId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const list = await invoke<ClusterFeedback[]>("list_cluster_feedback", {
        clusterId,
      });
      setItems(list);
    } catch (e) {
      toast.error(
        t("settings.summary.feedbackLoadFailed", { error: String(e) }),
      );
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  const add = useCallback(
    async (thumb: "up" | "down", note?: string) => {
      if (!clusterId) return;
      try {
        await invoke<number>("add_cluster_feedback", {
          clusterId,
          thumb,
          note: note ?? null,
        });
        await refresh();
      } catch (e) {
        toast.error(
          t("settings.summary.feedbackSubmitFailed", { error: String(e) }),
        );
      }
    },
    [clusterId, refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await invoke("delete_cluster_feedback", { id });
        await refresh();
      } catch (e) {
        toast.error(
          t("settings.summary.feedbackDeleteFailed", { error: String(e) }),
        );
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, refresh, add, remove };
}

export function useRecentNegativeFeedback() {
  const [items, setItems] = useState<ClusterFeedback[]>([]);
  const refresh = useCallback(async () => {
    try {
      const list = await invoke<ClusterFeedback[]>(
        "list_recent_negative_cluster_feedback",
        { days: 30, limit: 20 },
      );
      setItems(list);
    } catch (e) {
      console.warn("failed to load recent negative feedback", e);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { items, refresh };
}
