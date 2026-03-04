// HotwordSettings - Main component for managing hotwords with category filtering

import { AlertDialog, Button, Flex } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import {
  type Hotword,
  type HotwordCategory,
  type HotwordScenario,
} from "../../../types/hotword";
import { Card } from "../../ui/Card";
import { AddHotwordDialog } from "./AddHotwordDialog";
import { BatchAddDialog } from "./BatchAddDialog";
import { EditHotwordDialog } from "./EditHotwordDialog";
import { HotwordTable } from "./HotwordTable";

// Filter type includes "all" plus all categories
type FilterType = "all" | HotwordCategory;

export const HotwordSettings: React.FC = () => {
  const [hotwords, setHotwords] = useState<Hotword[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [editingHotword, setEditingHotword] = useState<Hotword | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Load hotwords
  const loadHotwords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Hotword[]>("get_hotwords");
      setHotwords(result);
    } catch (e) {
      console.error("[HotwordSettings] Failed to load hotwords:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHotwords();
  }, [loadHotwords]);

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter]);

  // Filter hotwords by category (with null safety)
  const filteredHotwords = React.useMemo(
    () =>
      filter === "all"
        ? hotwords.filter((h) => h != null)
        : hotwords.filter((h) => h != null && h.category === filter),
    [filter, hotwords],
  );

  // Add hotword handler
  const handleAddHotword = async (
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

  // Batch add handler
  const handleBatchAdd = async (targets: string[]) => {
    for (const target of targets) {
      try {
        // Infer category for each target
        const [category] = await invoke<[HotwordCategory, number]>(
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

  // Edit handler
  const handleEditHotword = async (
    id: number,
    target: string,
    originals: string[],
    category: HotwordCategory,
    scenarios: HotwordScenario[],
  ) => {
    try {
      await invoke<Hotword>("update_hotword", {
        id,
        target,
        originals,
        category,
        scenarios,
      });
      // Reload all hotwords to ensure consistent state
      await loadHotwords();
    } catch (e) {
      console.error(`[HotwordSettings] Failed to edit hotword ${id}:`, e);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (deleteId === null) return;

    try {
      await invoke("delete_hotword", { id: deleteId });
      setHotwords((prev) => prev.filter((h) => h && h.id !== deleteId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteId);
        return next;
      });
    } catch (e) {
      console.error("[HotwordSettings] Failed to delete hotword:", e);
    } finally {
      setDeleteId(null);
    }
  };

  // Selection handlers
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredHotwords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(
        new Set(filteredHotwords.filter((h) => h != null).map((h) => h.id)),
      );
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Batch action handlers
  const handleBatchChangeCategory = async (newCategory: HotwordCategory) => {
    for (const id of selectedIds) {
      const hotword = hotwords.find((h) => h && h.id === id);
      if (hotword && hotword.category !== newCategory) {
        try {
          await invoke<Hotword>("update_hotword", {
            id,
            target: hotword.target,
            originals: hotword.originals,
            category: newCategory,
            scenarios: hotword.scenarios,
          });
        } catch (e) {
          console.error(`[HotwordSettings] Failed to update hotword ${id}:`, e);
        }
      }
    }
    clearSelection();
    await loadHotwords();
  };

  const handleBatchChangeScenarios = async (
    newScenarios: HotwordScenario[],
  ) => {
    for (const id of selectedIds) {
      const hotword = hotwords.find((h) => h && h.id === id);
      if (hotword) {
        try {
          await invoke<Hotword>("update_hotword", {
            id,
            target: hotword.target,
            originals: hotword.originals,
            category: hotword.category,
            scenarios: newScenarios,
          });
        } catch (e) {
          console.error(`[HotwordSettings] Failed to update hotword ${id}:`, e);
        }
      }
    }
    clearSelection();
    await loadHotwords();
  };

  const handleBatchDelete = async () => {
    for (const id of selectedIds) {
      try {
        await invoke("delete_hotword", { id });
      } catch (e) {
        console.error(`[HotwordSettings] Failed to delete hotword ${id}:`, e);
      }
    }
    clearSelection();
    await loadHotwords();
  };

  // Export handler
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

  // Import handler
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

        // Support both old string[] format and new object format
        if (Array.isArray(imported)) {
          // Old format: string[]
          for (const target of imported) {
            if (typeof target === "string" && target.trim()) {
              const [category] = await invoke<[HotwordCategory, number]>(
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
          // New format: { version: "2.0", hotwords: [...] }
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
    <>
      <Card className="max-w-5xl w-full mx-auto p-0 flex flex-col">
        <HotwordTable
          hotwords={hotwords}
          loading={loading}
          filter={filter}
          onFilterChange={setFilter}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onClearSelection={clearSelection}
          onEdit={setEditingHotword}
          onDelete={setDeleteId}
          onBatchChangeCategory={handleBatchChangeCategory}
          onBatchChangeScenarios={handleBatchChangeScenarios}
          onBatchDelete={handleBatchDelete}
          onAddClick={() => setAddDialogOpen(true)}
          onBatchAddClick={() => setBatchDialogOpen(true)}
          onImport={handleImport}
          onExport={handleExport}
        />
      </Card>

      {/* Add Dialog */}
      <AddHotwordDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAddHotword}
      />

      {/* Batch Add Dialog */}
      <BatchAddDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        onBatchAdd={handleBatchAdd}
      />

      {/* Edit Dialog */}
      <EditHotwordDialog
        hotword={editingHotword}
        onOpenChange={() => setEditingHotword(null)}
        onSave={handleEditHotword}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog.Root
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
      >
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description size="2">
            确定要删除这个热词吗？此操作无法撤销。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={handleDelete}>
                删除
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
};
