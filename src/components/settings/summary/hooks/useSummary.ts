import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type {
  PeriodSelection,
  Summary,
  SummaryStats,
  UserProfile,
} from "../summaryTypes";

export function useSummary() {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryList, setSummaryList] = useState<Summary[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Load summary list on mount
  useEffect(() => {
    loadSummaryList();
    loadUserProfile();
  }, []);

  const loadSummaryList = useCallback(async () => {
    try {
      const list = await invoke<Summary[]>("get_summary_list");
      setSummaryList(list);
    } catch (error) {
      console.error("Failed to load summary list:", error);
    }
  }, []);

  const loadUserProfile = useCallback(async () => {
    try {
      const profile = await invoke<UserProfile>("get_user_profile");
      setUserProfile(profile);
    } catch (error) {
      console.error("Failed to load user profile:", error);
    }
  }, []);

  const loadStats = useCallback(async (selection: PeriodSelection) => {
    setLoading(true);
    try {
      const result = await invoke<SummaryStats>("get_summary_stats", {
        periodType: selection.type,
        startTs: selection.startTs,
        endTs: selection.endTs,
      });
      setStats(result);
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async (selection: PeriodSelection) => {
    setLoading(true);
    try {
      const result = await invoke<Summary>("get_or_create_summary", {
        periodType: selection.type,
        startTs: selection.startTs,
        endTs: selection.endTs,
      });
      setSummary(result);
      setStats(result.stats);
    } catch (error) {
      console.error("Failed to load summary:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateFeedbackStyle = useCallback(
    async (style: string) => {
      try {
        await invoke("update_feedback_style", { feedbackStyle: style });
        await loadUserProfile();
      } catch (error) {
        console.error("Failed to update feedback style:", error);
      }
    },
    [loadUserProfile],
  );

  const updateStylePrompt = useCallback(
    async (prompt: string) => {
      try {
        await invoke("update_style_prompt", { stylePrompt: prompt });
        await loadUserProfile();
      } catch (error) {
        console.error("Failed to update style prompt:", error);
      }
    },
    [loadUserProfile],
  );

  const exportSummary = useCallback(
    async (summaryId: number, format: "markdown" | "json") => {
      try {
        const content = await invoke<string>("export_summary", {
          summaryId,
          format,
        });

        // Create blob and trigger download
        const blob = new Blob([content], {
          type: format === "json" ? "application/json" : "text/markdown",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `summary-${summaryId}.${format === "json" ? "json" : "md"}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error("Failed to export summary:", error);
      }
    },
    [],
  );

  return {
    stats,
    summary,
    summaryList,
    userProfile,
    loading,
    generating,
    loadStats,
    loadSummary,
    loadSummaryList,
    loadUserProfile,
    updateFeedbackStyle,
    updateStylePrompt,
    exportSummary,
  };
}
