import { Box, Flex, Text } from "@radix-ui/themes";
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

export type OverlayState = "recording" | "transcribing" | "llm";
type SherpaPartialEvent = {
  text: string;
  punctuated_text?: string;
  is_final: boolean;
};
type OverlayErrorEvent = { code?: string; message?: string };

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

interface RecordingOverlayProps {
  initialState: OverlayState;
}

const RecordingOverlay: React.FC<RecordingOverlayProps> = ({
  initialState,
}) => {
  const { t } = useTranslation();
  // isVisible is implicitly true if we are mounted
  const [state, setState] = useState<OverlayState>(initialState);
  const [levels, setLevels] = useState<number[]>(Array(16).fill(0));
  const [accentColor, setAccentColor] = useState<string>(getAccentColor);
  const [realtimeText, setRealtimeText] = useState<string>("");
  const [realtimeIsFinal, setRealtimeIsFinal] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const smoothedLevelsRef = useRef<number[]>(Array(16).fill(0));
  const realtimeScrollRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<OverlayState>(initialState);
  const allowNonFinalRef = useRef<boolean>(true);
  const finalLockedRef = useRef<boolean>(false);
  const animatedEllipsis = useAnimatedEllipsis(
    state === "recording" && realtimeText.trim().length > 0 && !realtimeIsFinal,
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // If initial state changes (unlikely if unmounted, but good practice)
  useEffect(() => {
    setState(initialState);
    stateRef.current = initialState;
    if (initialState === "recording") {
      finalLockedRef.current = false;
      allowNonFinalRef.current = true;
      setRealtimeText("");
      setRealtimeIsFinal(false);
      setErrorText("");
    }
  }, [initialState]);

  useEffect(() => {
    const setupEventListeners = async () => {
      const unlistenError = await listen<OverlayErrorEvent>(
        "overlay-error",
        (event) => {
          const payload = (event.payload ?? {}) as OverlayErrorEvent;

          if (payload.code) {
            // Map backend error codes to translation keys
            const errorMap: Record<string, string> = {
              transcription_failed_saved:
                "overlay.error.transcriptionFailedSaved",
              llm_init_failed: "overlay.error.llmInitFailed",
              llm_request_failed: "overlay.error.llmRequestFailed",
              apple_intelligence_unavailable:
                "overlay.error.appleIntelligenceUnavailable",
              apple_intelligence_failed:
                "overlay.error.appleIntelligenceFailed",
            };

            const key = errorMap[payload.code];
            if (key) {
              setErrorText(t(key));
              return;
            }
          }

          // Fallback to raw message if provided (legacy or custom)
          if (payload.message) {
            setErrorText(payload.message);
            return;
          }
        },
      );

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

        // Use raw text or punctuated text directly, no normalization
        const text = (payload?.punctuated_text ?? payload?.text ?? "").trim();

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

      const unlistenStateUpdate = await listen("show-overlay", (event) => {
        const overlayState = event.payload as OverlayState;
        setState(overlayState);
        // Reset buffer if restarting recording
        if (overlayState === "recording") {
          setRealtimeText("");
          setRealtimeIsFinal(false);
          setErrorText("");
          allowNonFinalRef.current = true;
          finalLockedRef.current = false;
        }
      });

      // Listen for theme changes from localStorage (when main app changes theme)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
          setAccentColor(getAccentColor());
        }
      };

      window.addEventListener("storage", handleStorageChange);

      // Cleanup function
      return () => {
        unlistenError();
        unlistenLevel();
        unlistenSherpaOnlinePartial();
        unlistenSherpaOfflinePartial();
        unlistenStateUpdate();
        window.removeEventListener("storage", handleStorageChange);
      };
    };

    setupEventListeners();
  }, []); // Run once on mount

  // Update CSS variable when accent color changes
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--overlay-accent-color",
      accentColor,
    );
  }, [accentColor]);

  useEffect(() => {
    const el = realtimeScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [realtimeText, realtimeIsFinal, state]);

  const getIcon = () => {
    if (Boolean(errorText) && state !== "recording") {
      return <CancelIcon color="var(--ruby-9)" />;
    }
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

  const showRealtimeText =
    realtimeDisplayText.length > 0 && state === "recording";
  const showErrorText = Boolean(errorText) && state !== "recording";

  return (
    <Box className="overlay-root">
      <Box
        className={`recording-overlay fade-in ${
          showRealtimeText ? "has-realtime" : ""
        }`}
      >
        <Flex className="overlay-left">{getIcon()}</Flex>

        <Flex className="overlay-middle">
          {showRealtimeText && (
            <Box
              ref={realtimeScrollRef}
              className={`realtime-scroll ${realtimeIsFinal ? "final" : ""}`}
            >
              <Text className="realtime-text">{realtimeDisplayText}</Text>
            </Box>
          )}

          {!showRealtimeText && state === "recording" && (
            <>
              <Flex className="bars-container">
                {levels.map((v, i) => (
                  <Box
                    key={i}
                    className="bar"
                    style={{
                      height: `${Math.min(20, 4 + Math.pow(v, 0.7) * 16)}px`,
                      transition:
                        "height 60ms ease-out, opacity 120ms ease-out",
                      opacity: Math.max(0.2, v * 1.7),
                    }}
                  />
                ))}
              </Flex>
            </>
          )}
          {!showRealtimeText && state !== "recording" && (
            <Flex direction="column" className="status-text" align="center">
              {!showErrorText && <Text>{statusTextMap[state]}</Text>}
              {showErrorText && (
                <Text style={{ color: "var(--ruby-9)", fontWeight: "bold" }}>
                  {errorText}
                </Text>
              )}
            </Flex>
          )}
        </Flex>

        <Flex className="overlay-right">
          {state === "recording" && (
            <Box
              className="cancel-button"
              onClick={() => {
                invoke("cancel_operation");
              }}
            >
              <CancelIcon />
            </Box>
          )}
        </Flex>
      </Box>
    </Box>
  );
};

export default RecordingOverlay;
