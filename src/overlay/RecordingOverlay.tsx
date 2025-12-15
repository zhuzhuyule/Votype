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

const stripTrailingSentencePunctuation = (input: string) => {
  let out = input.trimEnd();
  if (!out) return out;

  // For in-progress display: if the model already produced a sentence terminator,
  // temporarily hide it to convey "still listening".
  out = out.replace(/[。！？.!?]+$/g, "");
  // Also strip trailing ellipsis forms.
  out = out.replace(/·+$/g, "");
  return out.trimEnd();
};

const useAnimatedEllipsis = (enabled: boolean) => {
  const [ellipsis, setEllipsis] = useState("…");
  useEffect(() => {
    if (!enabled) {
      setEllipsis("");
      return;
    }
    const frames = ["·", "··", "···"];
    let idx = 0;
    setEllipsis(frames[idx]);
    const id = window.setInterval(() => {
      idx = (idx + 1) % frames.length;
      setEllipsis(frames[idx]);
    }, 350);
    return () => window.clearInterval(id);
  }, [enabled]);
  return ellipsis;
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
  const stateRef = useRef<OverlayState>("recording");
  const allowNonFinalRef = useRef<boolean>(true);
  const finalLockedRef = useRef<boolean>(false);
  const animatedEllipsis = useAnimatedEllipsis(
    isVisible && state === "recording" && realtimeText.trim().length > 0 && !realtimeIsFinal,
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const setupEventListeners = async () => {
      // Listen for show-overlay event from Rust
      const unlistenShow = await listen("show-overlay", (event) => {
        const overlayState = event.payload as OverlayState;
        setState(overlayState);
        stateRef.current = overlayState;
        setIsVisible(true);
        // Once the stop signal arrives we should immediately show "transcribing" rather than
        // stale partial text, and ignore any non-final partials that might still arrive.
        allowNonFinalRef.current = overlayState === "recording";
        if (overlayState === "recording") {
          finalLockedRef.current = false;
        }
        // Reset the realtime view when entering a new phase. In particular, once the stop signal
        // arrives we should immediately show "transcribing" rather than stale partial text.
        if (overlayState === "recording" || overlayState === "transcribing") {
          setRealtimeText("");
          setRealtimeIsFinal(false);
        }
      });

      // Listen for hide-overlay event from Rust
      const unlistenHide = await listen("hide-overlay", () => {
        setIsVisible(false);
        setRealtimeText("");
        setRealtimeIsFinal(false);
        // Next session can accept non-final partials again.
        allowNonFinalRef.current = true;
        finalLockedRef.current = false;
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

      const handlePartial = (event: { payload: SherpaPartialEvent }) => {
        const payload = event.payload as SherpaPartialEvent;
        const isFinal = Boolean(payload?.is_final);
        // Once we enter "transcribing"/"llm", the overlay should not display long text anymore.
        // Showing any late partial/final payloads here causes confusing "flash back" to old text.
        if (stateRef.current !== "recording") {
          return;
        }
        if (finalLockedRef.current) {
          return;
        }
        if (!isFinal && !allowNonFinalRef.current) {
          return;
        }
        const rawText = (payload?.punctuated_text ?? payload?.text ?? "").trim();
        const text = payload?.punctuated_text
          ? rawText
          : normalizeDictatedPunctuation(rawText);
        setRealtimeText(text);
        setRealtimeIsFinal(isFinal);

        // After we have displayed a final result, ignore any subsequent non-final partials from
        // background workers until a new recording starts.
        if (isFinal) {
          allowNonFinalRef.current = false;
          finalLockedRef.current = true;
        }
      };

      const unlistenSherpaOnlinePartial = await listen<SherpaPartialEvent>(
        "sherpa-online-partial",
        handlePartial as any,
      );

      const unlistenSherpaOfflinePartial = await listen<SherpaPartialEvent>(
        "sherpa-offline-partial",
        handlePartial as any,
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
        unlistenSherpaOnlinePartial();
        unlistenSherpaOfflinePartial();
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
  }, [realtimeText, realtimeIsFinal, state, isVisible]);

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

  const realtimeDisplayText =
    state === "recording" && !realtimeIsFinal
      ? `${stripTrailingSentencePunctuation(realtimeText)}${animatedEllipsis}`.trim()
      : realtimeText;

  const showRealtimeText = realtimeDisplayText.length > 0 && state === "recording";

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
              <div className="realtime-text">{realtimeDisplayText}</div>
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
