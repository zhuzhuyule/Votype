// HotwordSettings - Main component for managing hotwords

import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import type {
  Hotword,
  HotwordCategory,
  HotwordScenario,
} from "../../../types/hotword";
import { HotwordTagCloud } from "./HotwordTagCloud";

export const HotwordSettings: React.FC = () => {
  const [hotwords, setHotwords] = useState<Hotword[]>([]);
  const [suggestions, setSuggestions] = useState<Hotword[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHotwords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Hotword[]>("get_hotwords");
      setHotwords(result.filter((h) => h.status === "active"));
    } catch (e) {
      console.error("[HotwordSettings] Failed to load hotwords:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    try {
      const result = await invoke<Hotword[]>("get_hotword_suggestions");
      setSuggestions(result);
    } catch (e) {
      console.error("[HotwordSettings] Failed to load suggestions:", e);
    }
  }, []);

  useEffect(() => {
    loadHotwords();
    loadSuggestions();
  }, [loadHotwords, loadSuggestions]);

  // Add hotword
  const handleAdd = async (
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => {
    const newHotword = await invoke<Hotword>("add_hotword", {
      target,
      originals,
      category,
      scenarios,
    });
    setHotwords((prev) => [...prev, newHotword]);
  };

  // Batch add
  const handleBatchAdd = async (targets: string[]) => {
    for (const target of targets) {
      try {
        const category = await invoke<HotwordCategory>(
          "infer_hotword_category",
          { target },
        );
        const newHotword = await invoke<Hotword>("add_hotword", {
          target,
          originals: [],
          category,
          scenarios: ["work", "casual"],
        });
        setHotwords((prev) => [...prev, newHotword]);
      } catch (e) {
        console.error(`[HotwordSettings] Failed to add "${target}":`, e);
      }
    }
  };

  // Update category (drag-and-drop)
  const handleUpdateCategory = async (
    id: number,
    category: HotwordCategory,
  ) => {
    const hotword = hotwords.find((h) => h.id === id);
    if (!hotword) return;
    try {
      await invoke("update_hotword", {
        id,
        target: null,
        originals: hotword.originals,
        category,
        scenarios: hotword.scenarios,
      });
      setHotwords((prev) =>
        prev.map((h) => (h.id === id ? { ...h, category } : h)),
      );
    } catch (e) {
      console.error("[HotwordSettings] Failed to update category:", e);
    }
  };

  // Delete
  const handleDelete = async (id: number) => {
    try {
      await invoke("delete_hotword", { id });
      setHotwords((prev) => prev.filter((h) => h.id !== id));
    } catch (e) {
      console.error("[HotwordSettings] Failed to delete:", e);
    }
  };

  // Suggestion handlers
  const handleAcceptSuggestion = async (id: number) => {
    try {
      await invoke("accept_hotword_suggestion", { id });
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      await loadHotwords();
    } catch (e) {
      console.error("[HotwordSettings] Failed to accept suggestion:", e);
    }
  };

  const handleDismissSuggestion = async (id: number) => {
    try {
      await invoke("dismiss_hotword_suggestion", { id });
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("[HotwordSettings] Failed to dismiss suggestion:", e);
    }
  };

  const handleAcceptAll = async () => {
    try {
      await invoke("accept_all_hotword_suggestions");
      setSuggestions([]);
      await loadHotwords();
    } catch (e) {
      console.error("[HotwordSettings] Failed to accept all:", e);
    }
  };

  const handleDismissAll = async () => {
    try {
      await invoke("dismiss_all_hotword_suggestions");
      setSuggestions([]);
    } catch (e) {
      console.error("[HotwordSettings] Failed to dismiss all:", e);
    }
  };

  // Export
  const handleExport = () => {
    const exportData = {
      version: "2.0",
      hotwords: hotwords.map((h) => ({
        target: h.target,
        originals: h.originals,
        category: h.category,
        scenarios: h.scenarios,
      })),
    };
    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hotwords.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);

        if (Array.isArray(imported)) {
          for (const target of imported) {
            if (typeof target === "string" && target.trim()) {
              const category = await invoke<HotwordCategory>(
                "infer_hotword_category",
                { target: target.trim() },
              );
              const newHotword = await invoke<Hotword>("add_hotword", {
                target: target.trim(),
                originals: [],
                category,
                scenarios: ["work", "casual"],
              });
              setHotwords((prev) => [...prev, newHotword]);
            }
          }
        } else if (
          imported.version === "2.0" &&
          Array.isArray(imported.hotwords)
        ) {
          for (const h of imported.hotwords) {
            if (h.target && typeof h.target === "string") {
              const newHotword = await invoke<Hotword>("add_hotword", {
                target: h.target.trim(),
                originals: Array.isArray(h.originals) ? h.originals : [],
                category: h.category || "term",
                scenarios: Array.isArray(h.scenarios)
                  ? h.scenarios
                  : ["work", "casual"],
              });
              setHotwords((prev) => [...prev, newHotword]);
            }
          }
        }
      } catch (err) {
        console.error("[HotwordSettings] Import failed:", err);
      }
    };
    input.click();
  };

  return (
    <HotwordTagCloud
      hotwords={hotwords}
      suggestions={suggestions}
      loading={loading}
      onAddHotword={handleAdd}
      onBatchAdd={handleBatchAdd}
      onDelete={handleDelete}
      onUpdateCategory={handleUpdateCategory}
      onReload={loadHotwords}
      onAcceptSuggestion={handleAcceptSuggestion}
      onDismissSuggestion={handleDismissSuggestion}
      onAcceptAll={handleAcceptAll}
      onDismissAll={handleDismissAll}
      onImport={handleImport}
      onExport={handleExport}
    />
  );
};
