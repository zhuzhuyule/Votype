import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HotwordCategoryMeta } from "../types/hotword";

export function useHotwordCategories() {
  const [categories, setCategories] = useState<HotwordCategoryMeta[]>([]);

  const reload = useCallback(async () => {
    try {
      const result = await invoke<HotwordCategoryMeta[]>(
        "get_hotword_categories",
      );
      setCategories(result);
    } catch (e) {
      console.error("[useHotwordCategories] Failed to load categories:", e);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const categoryMap = useMemo(() => {
    const map: Record<string, HotwordCategoryMeta> = {};
    for (const cat of categories) {
      map[cat.id] = cat;
    }
    return map;
  }, [categories]);

  const sortedIds = useMemo(() => categories.map((c) => c.id), [categories]);

  const addCategory = useCallback(
    async (id: string, label: string, color: string, icon: string) => {
      const result = await invoke<HotwordCategoryMeta>("add_hotword_category", {
        id,
        label,
        color,
        icon,
      });
      setCategories((prev) => [...prev, result]);
      return result;
    },
    [],
  );

  const updateCategory = useCallback(
    async (
      id: string,
      updates: {
        label?: string;
        color?: string;
        icon?: string;
        sort_order?: number;
      },
    ) => {
      await invoke("update_hotword_category", { id, ...updates });
      await reload();
    },
    [reload],
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      await invoke("delete_hotword_category", { id });
      await reload();
    },
    [reload],
  );

  return {
    categories,
    categoryMap,
    sortedIds,
    reload,
    addCategory,
    updateCategory,
    deleteCategory,
  };
}
