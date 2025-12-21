import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const STORAGE_KEY = "votype-compact-mode";

interface CompactModeContextValue {
  compactMode: boolean;
  toggleCompactMode: () => void;
  setCompactMode: (value: boolean) => void;
}

const CompactModeContext = createContext<CompactModeContextValue | null>(null);

export const CompactModeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [compactMode, setCompactModeState] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "true";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(compactMode));
  }, [compactMode]);

  const toggleCompactMode = useCallback(() => {
    setCompactModeState((prev) => !prev);
  }, []);

  const setCompactMode = useCallback((value: boolean) => {
    setCompactModeState(value);
  }, []);

  return (
    <CompactModeContext.Provider
      value={{ compactMode, toggleCompactMode, setCompactMode }}
    >
      {children}
    </CompactModeContext.Provider>
  );
};

export const useCompactMode = (): CompactModeContextValue => {
  const context = useContext(CompactModeContext);
  if (!context) {
    throw new Error("useCompactMode must be used within a CompactModeProvider");
  }
  return context;
};

// Optional: Safe hook that returns false if not in provider (for components that may be outside)
export const useCompactModeSafe = (): boolean => {
  const context = useContext(CompactModeContext);
  return context?.compactMode ?? false;
};
