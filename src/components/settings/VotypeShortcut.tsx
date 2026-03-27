import { Flex } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "../../hooks/useSettings";
import {
  getKeyName,
  type KeyToken,
  normalizeKey,
  type OSType,
  parseKeyCombination,
} from "../../lib/utils/keyboard";
import { ActionWrapper } from "../ui";
import { SettingContainer } from "../ui/SettingContainer";

interface VotypeShortcutProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  shortcutId: string;
  disabled?: boolean;
}

export const VotypeShortcut: React.FC<VotypeShortcutProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
  shortcutId,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const {
    getSetting,
    updateBinding,
    resetBinding,
    isUpdating,
    isLoading,
    settings,
  } = useSettings();
  const [keyPressed, setKeyPressed] = useState<string[]>([]);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(
    null,
  );
  const [originalBinding, setOriginalBinding] = useState<string>("");
  const [osType, setOsType] = useState<OSType>("unknown");

  const keyboardImplementation = settings?.keyboard_implementation || "tauri";
  const isHandyKeys = keyboardImplementation === "handy_keys";

  const bindings = getSetting("bindings") || {};
  const binding = bindings[shortcutId];

  const localizedTitle = binding
    ? t(`settings.general.shortcut.bindings.${shortcutId}.name`, {
        defaultValue: binding.name,
      })
    : t("settings.general.shortcut.title");

  const localizedDescription = binding
    ? t(`settings.general.shortcut.bindings.${shortcutId}.description`, {
        defaultValue: binding.description,
      })
    : t("settings.general.shortcut.notFound");

  // Detect and store OS type
  useEffect(() => {
    const detectOsType = async () => {
      try {
        const detectedType = type();
        let normalizedType: OSType;

        switch (detectedType) {
          case "macos":
            normalizedType = "macos";
            break;
          case "windows":
            normalizedType = "windows";
            break;
          case "linux":
            normalizedType = "linux";
            break;
          default:
            normalizedType = "unknown";
        }

        setOsType(normalizedType);
      } catch (error) {
        console.error("Error detecting OS type:", error);
        setOsType("unknown");
      }
    };

    detectOsType();
  }, []);

  // Refs for values that event handlers need to access
  // without causing useEffect to re-run on every keystroke
  const originalBindingRef = useRef(originalBinding);
  originalBindingRef.current = originalBinding;
  const osTypeRef = useRef(osType);
  osTypeRef.current = osType;
  const recordedKeysRef = useRef(recordedKeys);
  recordedKeysRef.current = recordedKeys;
  const updateBindingRef = useRef(updateBinding);
  updateBindingRef.current = updateBinding;

  // Cancel recording - stable via useCallback, reads from refs
  const cancelRecording = useCallback(async () => {
    if (!editingShortcutId) return;
    try {
      if (originalBindingRef.current) {
        await updateBindingRef.current(
          editingShortcutId,
          originalBindingRef.current,
        );
      }
      await invoke("resume_binding", { id: editingShortcutId }).catch(
        console.error,
      );
    } catch (error) {
      console.error("Failed to restore original binding:", error);
      toast.error(t("settings.general.shortcut.errors.restore"));
    }

    if (isHandyKeys) {
      await invoke("stop_handy_keys_recording").catch(console.error);
    }
    setEditingShortcutId(null);
    setKeyPressed([]);
    setRecordedKeys([]);
    setOriginalBinding("");
  }, [editingShortcutId, isHandyKeys, t]);

  useEffect(() => {
    // Only add event listeners when we're in editing mode
    if (editingShortcutId === null) return;

    let cleanup = false;
    let unlisten: (() => void) | null = null;

    const finalizeRecording = async (shortcut: string) => {
      if (!editingShortcutId) return;
      try {
        await updateBindingRef.current(editingShortcutId, shortcut);
        await invoke("resume_binding", { id: editingShortcutId }).catch(
          console.error,
        );
      } catch (error) {
        console.error("Failed to change binding:", error);
        toast.error(
          t("settings.general.shortcut.errors.set", {
            error: error instanceof Error ? error.message : String(error),
          }),
        );

        if (originalBindingRef.current) {
          try {
            await updateBindingRef.current(
              editingShortcutId,
              originalBindingRef.current,
            );
            await invoke("resume_binding", { id: editingShortcutId }).catch(
              console.error,
            );
          } catch (resetError) {
            console.error("Failed to reset binding:", resetError);
            toast.error(t("settings.general.shortcut.errors.reset"));
          }
        }
      }

      if (isHandyKeys) {
        await invoke("stop_handy_keys_recording").catch(console.error);
      }
      setEditingShortcutId(null);
      setKeyPressed([]);
      setRecordedKeys([]);
      setOriginalBinding("");
    };

    if (isHandyKeys) {
      // Backend recording mode
      const pressedKeys = new Set<string>();
      let bestHotkey = "";

      const setupHandyKeysListener = async () => {
        unlisten = await listen<{
          modifiers: string[];
          key: string | null;
          is_key_down: boolean;
          hotkey_string: string;
        }>("handy-keys-event", (event) => {
          if (cleanup) return;
          const { modifiers, key, is_key_down, hotkey_string } = event.payload;

          if (is_key_down) {
            for (const mod of modifiers) pressedKeys.add(mod);
            if (key) pressedKeys.add(key);
            setKeyPressed([...pressedKeys]);

            if (
              hotkey_string &&
              hotkey_string !== "none" &&
              hotkey_string.length >= bestHotkey.length
            ) {
              bestHotkey = hotkey_string;
              setRecordedKeys(hotkey_string.split("+"));
            }
          } else {
            // Key up: remove released key and sync with current modifier state
            if (key) pressedKeys.delete(key);
            for (const tracked of [...pressedKeys]) {
              if (!modifiers.includes(tracked)) {
                pressedKeys.delete(tracked);
              }
            }

            setKeyPressed([...pressedKeys]);

            // Finalize immediately when all keys are released
            if (pressedKeys.size === 0 && bestHotkey) {
              finalizeRecording(bestHotkey);
            }
          }
        });
      };

      setupHandyKeysListener();

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") cancelRecording();
      };
      const handleBlur = () => cancelRecording();
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest(`[data-shortcut-id="${shortcutId}"]`)) {
          cancelRecording();
        }
      };

      window.addEventListener("keydown", handleEscape);
      window.addEventListener("blur", handleBlur);
      document.addEventListener("mousedown", handleClickOutside, true);

      return () => {
        cleanup = true;
        if (unlisten) unlisten();
        window.removeEventListener("keydown", handleEscape);
        window.removeEventListener("blur", handleBlur);
        document.removeEventListener("mousedown", handleClickOutside, true);
      };
    } else {
      // Browser fallback recording mode
      const handleKeyDown = async (e: KeyboardEvent) => {
        if (cleanup) return;
        if (e.repeat) return;
        if (e.key === "Escape") {
          cancelRecording();
          return;
        }
        e.preventDefault();

        const rawKey = getKeyName(e, osTypeRef.current);
        const key = normalizeKey(rawKey);

        setKeyPressed((prev) => {
          if (prev.includes(key)) return prev;
          return [...prev, key];
        });
        setRecordedKeys((prev) => {
          if (prev.includes(key)) return prev;
          return [...prev, key];
        });
      };

      const handleKeyUp = async (e: KeyboardEvent) => {
        if (cleanup) return;
        e.preventDefault();

        const rawKey = getKeyName(e, osTypeRef.current);
        const key = normalizeKey(rawKey);

        setKeyPressed((prev) => {
          const next = prev.filter((k) => k !== key);
          if (next.length === 0 && recordedKeysRef.current.length > 0) {
            finalizeRecording(recordedKeysRef.current.join("+"));
          }
          return next;
        });
      };

      const handleBlur = () => cancelRecording();
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest(`[data-shortcut-id="${shortcutId}"]`)) {
          cancelRecording();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      window.addEventListener("blur", handleBlur);
      document.addEventListener("mousedown", handleClickOutside, true);

      return () => {
        cleanup = true;
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
        window.removeEventListener("blur", handleBlur);
        document.removeEventListener("mousedown", handleClickOutside, true);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingShortcutId, isHandyKeys, shortcutId, cancelRecording, t]);

  // Start recording a new shortcut
  const startRecording = async (id: string) => {
    if (editingShortcutId === id) {
      // Toggle off: if already recording this shortcut, cancel it
      cancelRecording();
      return;
    }

    // Suspend current binding to avoid firing while recording
    await invoke("suspend_binding", { id }).catch(console.error);

    if (isHandyKeys) {
      const result = await invoke("start_handy_keys_recording", {
        bindingId: id,
      }).catch((e) => {
        console.error("Failed to start handy-keys recording:", e);
        return false;
      });
      if (result === false) return;
    }

    // Store the original binding to restore if canceled
    setOriginalBinding(bindings[id]?.current_binding || "");
    setEditingShortcutId(id);
    setKeyPressed([]);
    setRecordedKeys([]);
  };

  // Parse the current shortcut keys being recorded
  const currentTokens = (): KeyToken[] => {
    if (recordedKeys.length === 0) return [];
    return parseKeyCombination(recordedKeys.join("+"), osType);
  };

  function renderKeyBadge(token: KeyToken, index: number) {
    // Build display text: prepend L/R side indicator for left/right modifiers
    const displayLabel = token.side
      ? `${token.side} ${token.label}`
      : token.label;
    // Single-char symbols (macOS ⌘⌥⇧⌃, arrows, etc.) get uniform square sizing;
    // multi-char labels (Ctrl, Alt, ⊞ Win, L ⌘, etc.) get extra horizontal padding.
    const isCompact = displayLabel.length <= 2;
    return (
      <Flex
        key={index}
        align="center"
        justify="center"
        className={`h-7 rounded-md border text-xs select-none leading-none ${
          isCompact ? "w-7" : "px-2"
        } ${
          token.isModifier
            ? "bg-(--gray-2) border-(--gray-5) text-(--gray-11) font-medium"
            : "bg-(--accent-3) border-(--accent-6) text-(--accent-11) font-mono"
        }`}
      >
        {displayLabel}
      </Flex>
    );
  }

  function renderKeys() {
    if (isLoading) {
      return (
        <Flex align="center" className="h-9 text-sm text-(--gray-8)">
          {t("settings.general.shortcut.loading")}
        </Flex>
      );
    }

    if (!binding) {
      return (
        <Flex align="center" className="h-9 text-sm text-(--gray-8)">
          {t("settings.general.shortcut.none")}
        </Flex>
      );
    }

    const isSame = editingShortcutId === shortcutId;
    const tokens = isSame
      ? currentTokens()
      : parseKeyCombination(binding.current_binding, osType);

    return (
      <Flex
        align="center"
        justify="end"
        gap="1"
        className="h-9 cursor-pointer"
        data-shortcut-id={shortcutId}
        onClick={() => startRecording(shortcutId)}
      >
        {tokens.length === 0 ? (
          <span className="text-sm text-(--gray-8) animate-pulse">
            {t("settings.general.shortcut.pressKeys")}
          </span>
        ) : (
          tokens.map((token, i) => renderKeyBadge(token, i))
        )}
      </Flex>
    );
  }

  if (!binding) {
    return (
      <SettingContainer
        title={localizedTitle}
        description={localizedDescription}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="text-sm text-mid-gray">
          {t("settings.general.shortcut.none")}
        </div>
      </SettingContainer>
    );
  }

  return (
    <SettingContainer
      title={localizedTitle}
      description={localizedDescription}
      descriptionMode={descriptionMode}
      grouped={grouped}
      disabled={disabled}
      layout="horizontal"
    >
      <ActionWrapper
        direction="row"
        onReset={() => resetBinding(shortcutId)}
        resetProps={{
          disabled: isUpdating(`binding_${shortcutId}`),
        }}
      >
        {renderKeys()}
      </ActionWrapper>
    </SettingContainer>
  );
};
