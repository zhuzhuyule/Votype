import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { TaskCluster } from "../summaryTypes";

interface TaskClustersState {
  clusters: TaskCluster[];
  loading: boolean;
  generating: boolean;
  error: string | null;
}

const cacheByDate = new Map<string, TaskCluster[]>();

export function useTaskClusters(date: string) {
  const { t } = useTranslation();
  const [state, setState] = useState<TaskClustersState>({
    clusters: cacheByDate.get(date) ?? [],
    loading: false,
    generating: false,
    error: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const list = await invoke<TaskCluster[]>("get_task_clusters_by_date", {
        date,
      });
      cacheByDate.set(date, list);
      if (mountedRef.current) {
        setState({
          clusters: list,
          loading: false,
          generating: false,
          error: null,
        });
      }
    } catch (e) {
      const msg = String(e);
      if (mountedRef.current) {
        setState((s) => ({ ...s, loading: false, error: msg }));
      }
      toast.error(t("settings.summary.clusterLoadFailed", { error: msg }));
    }
  }, [date]);

  const generate = useCallback(
    async (force: boolean) => {
      setState((s) => ({ ...s, generating: true, error: null }));
      try {
        const list = await invoke<TaskCluster[]>("generate_task_clusters", {
          date,
          force,
        });
        cacheByDate.set(date, list);
        if (mountedRef.current) {
          setState({
            clusters: list,
            loading: false,
            generating: false,
            error: null,
          });
        }
        if (force) toast.success(t("settings.summary.clusterRegenerated"));
      } catch (e) {
        const msg = String(e);
        if (mountedRef.current) {
          setState((s) => ({ ...s, generating: false, error: msg }));
        }
        toast.error(t("settings.summary.aiCallFailed", { error: msg }));
      }
    },
    [date],
  );

  const updateField = useCallback(
    async (
      clusterId: string,
      field: "title" | "status" | "next_step",
      value: string,
    ) => {
      try {
        await invoke("update_task_cluster_field", {
          clusterId,
          field,
          value,
        });
        await refresh();
      } catch (e) {
        toast.error(
          t("settings.summary.clusterUpdateFailed", { error: String(e) }),
        );
      }
    },
    [refresh],
  );

  const split = useCallback(
    async (
      clusterId: string,
      extractIds: number[],
      newTitle: string,
      extractedDurationMs: number,
    ) => {
      try {
        await invoke<string>("split_task_cluster", {
          clusterId,
          extractIds,
          newTitle,
          extractedDurationMs,
        });
        await refresh();
        toast.success(t("settings.summary.splitDone"));
      } catch (e) {
        toast.error(t("settings.summary.splitFailed", { error: String(e) }));
      }
    },
    [refresh],
  );

  const merge = useCallback(
    async (targetClusterId: string, sourceClusterIds: string[]) => {
      try {
        await invoke("merge_task_clusters", {
          targetClusterId,
          sourceClusterIds,
        });
        await refresh();
        toast.success(t("settings.summary.mergeDone"));
      } catch (e) {
        toast.error(t("settings.summary.mergeFailed", { error: String(e) }));
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (clusterId: string) => {
      try {
        await invoke("delete_task_cluster", { clusterId });
        await refresh();
      } catch (e) {
        toast.error(t("settings.summary.deleteFailed", { error: String(e) }));
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh, generate, updateField, split, merge, remove };
}
