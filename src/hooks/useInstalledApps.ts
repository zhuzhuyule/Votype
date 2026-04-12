import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export type InputCategory =
  | "input_capable"
  | "terminal"
  | "background"
  | "other";

export interface InstalledApp {
  name: string;
  icon_path: string | null;
  bundle_path: string;
  category: InputCategory;
}

// Module-level cache shared across all hook consumers
let cache: InstalledApp[] | null = null;
let cacheMap: Map<string, InstalledApp> | null = null;
let inflight: Promise<InstalledApp[]> | null = null;
const listeners = new Set<(apps: InstalledApp[]) => void>();

function setCache(apps: InstalledApp[]) {
  cache = apps;
  const map = new Map<string, InstalledApp>();
  for (const app of apps) {
    map.set(app.name.toLowerCase(), app);
  }
  cacheMap = map;
  listeners.forEach((fn) => fn(apps));
}

export async function fetchInstalledApps(
  refresh = false,
): Promise<InstalledApp[]> {
  if (cache && !refresh) return cache;
  if (inflight && !refresh) return inflight;

  inflight = invoke<InstalledApp[]>("list_installed_apps", { refresh })
    .then((apps) => {
      setCache(apps);
      return apps;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Synchronous lookup of the native icon for an app name.
 * Returns an asset URL ready for use in <img src=...>, or null if not found.
 */
export function getAppIconUrl(appName: string): string | null {
  if (!cacheMap) return null;
  const app = cacheMap.get(appName.toLowerCase());
  if (!app || !app.icon_path) return null;
  return convertFileSrc(app.icon_path, "asset");
}

/**
 * Returns true if an app with the given name is currently installed.
 * Returns null if the cache has not been loaded yet (indeterminate).
 */
export function isAppInstalled(appName: string): boolean | null {
  if (!cacheMap) return null;
  return cacheMap.has(appName.toLowerCase());
}

/**
 * Hook that returns the cached installed apps list, triggering a fetch
 * on first use. Re-renders automatically when the cache is updated.
 */
export function useInstalledApps() {
  const [apps, setApps] = useState<InstalledApp[] | null>(cache);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let mounted = true;
    const listener = (next: InstalledApp[]) => {
      if (mounted) setApps(next);
    };
    listeners.add(listener);

    if (cache === null) {
      setLoading(true);
      fetchInstalledApps()
        .catch((e) => console.error("Failed to load installed apps:", e))
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }

    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await fetchInstalledApps(true);
    } finally {
      setLoading(false);
    }
  }, []);

  return { apps, loading, refresh };
}
