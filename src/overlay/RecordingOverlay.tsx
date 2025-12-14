import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CancelIcon,
  MicrophoneIcon,
  TranscriptionIcon,
} from "../components/icons";
import { getAccentColor, STORAGE_KEY } from "../lib/theme";
import "./RecordingOverlay.css";

type OverlayState = "recording" | "transcribing" | "llm";
type SherpaPartialEvent = { text: string; punctuated_text?: string; is_final: boolean };

const normalizeDictatedPunctuation = (input: string) => {
  // Lightweight normalization for common dictated punctuation words.
  // This is only for overlay display; the final transcription path can still
  // apply its own post-processing.
  return input
    .replace(/点点点/g, "…")
    .replace(/省略号/g, "…")
    .replace(/逗号/g, "，")
    .replace(/句号/g, "。")
    .replace(/问号/g, "？")
    .replace(/叹号/g, "！")
    .replace(/感叹号/g, "！")
    .replace(/冒号/g, "：")
    .replace(/分号/g, "；");
};

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [levels, setLevels] = useState<number[]>(Array(16).fill(0));
  const [accentColor, setAccentColor] = useState<string>(getAccentColor);
  const [realtimeText, setRealtimeText] = useState<string>("");
  const [realtimeIsFinal, setRealtimeIsFinal] = useState<boolean>(false);
  const smoothedLevelsRef = useRef<number[]>(Array(16).fill(0));
  const realtimeScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const setupEventListeners = async () => {
      // Listen for show-overlay event from Rust
      const unlistenShow = await listen("show-overlay", (event) => {
        const overlayState = event.payload as OverlayState;
        setState(overlayState);
        setIsVisible(true);
        if (overlayState === "recording") {
          setRealtimeText("");
          setRealtimeIsFinal(false);
        }
      });

      // Listen for hide-overlay event from Rust
      const unlistenHide = await listen("hide-overlay", () => {
        setIsVisible(false);
        setRealtimeText("");
        setRealtimeIsFinal(false);
      });

      // Clear realtime text when returning to "recording" after a cycle.
      const unlistenWorkerExit = await listen("sherpa-online-worker-exited", () => {
        setRealtimeText("");
        setRealtimeIsFinal(false);
      });

      // Listen for mic-level updates
      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload as number[];

        // Apply smoothing to reduce jitter
        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = newLevels[i] || 0;
          return prev * 0.7 + target * 0.3; // Smooth transition
        });

        smoothedLevelsRef.current = smoothed;
        setLevels(smoothed.slice(0, 9));
      });

      const unlistenSherpaPartial = await listen<SherpaPartialEvent>(
        "sherpa-online-partial",
        (event) => {
          const payload = event.payload as SherpaPartialEvent;
          const rawText = (payload?.punctuated_text ?? payload?.text ?? "").trim();
          const text = payload?.punctuated_text
            ? rawText
            : normalizeDictatedPunctuation(rawText);
          setRealtimeText(text);
          setRealtimeIsFinal(Boolean(payload?.is_final));
        },
      );

      // Listen for theme changes from localStorage (when main app changes theme)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
          setAccentColor(getAccentColor());
        }
      };

      window.addEventListener("storage", handleStorageChange);

      // Cleanup function
      return () => {
        unlistenShow();
        unlistenHide();
        unlistenLevel();
        unlistenSherpaPartial();
        unlistenWorkerExit();
        window.removeEventListener("storage", handleStorageChange);
      };
    };

    setupEventListeners();
  }, []);

  // Update CSS variable when accent color changes
  useEffect(() => {
    document.documentElement.style.setProperty("--overlay-accent-color", accentColor);
  }, [accentColor]);

  useEffect(() => {
    const el = realtimeScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [realtimeText, isVisible]);

  const getIcon = () => {
    if (state === "recording") {
      return <MicrophoneIcon color={accentColor} />;
    } else {
      return <TranscriptionIcon color={accentColor} />;
    }
  };

  const statusTextMap: Record<OverlayState, string> = {
    recording: t("overlay.status.recording"),
    transcribing: t("overlay.status.transcribing"),
    llm: t("overlay.status.llm"),
  };

  const showRealtimeText =
    realtimeText.length > 0 && (state === "recording" || state === "transcribing");

  return (
    <div className="overlay-root">
      <div
        className={`recording-overlay ${isVisible ? "fade-in" : ""} ${
          showRealtimeText ? "has-realtime" : ""
        }`}
      >
        <div className="overlay-left">{getIcon()}</div>

        <div className="overlay-middle">
          {showRealtimeText && (
            <div
              ref={realtimeScrollRef}
              className={`realtime-scroll ${realtimeIsFinal ? "final" : ""}`}
            >
              <div className="realtime-text">{realtimeText}</div>
            </div>
          )}

          {!showRealtimeText && state === "recording" && (
            <>
              <div className="bars-container">
                {levels.map((v, i) => (
                  <div
                    key={i}
                    className="bar"
                    style={{
                      height: `${Math.min(20, 4 + Math.pow(v, 0.7) * 16)}px`,
                      transition: "height 60ms ease-out, opacity 120ms ease-out",
                      opacity: Math.max(0.2, v * 1.7),
                    }}
                  />
                ))}
              </div>
            </>
          )}
          {!showRealtimeText && state !== "recording" && (
            <div className="status-text">{statusTextMap[state]}</div>
          )}
        </div>

        <div className="overlay-right">
          {state === "recording" && (
            <div
              className="cancel-button"
              onClick={() => {
                invoke("cancel_operation");
              }}
            >
              <CancelIcon />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecordingOverlay;
