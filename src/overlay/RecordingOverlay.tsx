import { Box, Flex, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CancelIcon,
  MicrophoneIcon,
  TranscriptionIcon,
} from "../components/icons";
import { ASR_ONLINE_TIMEOUT } from "../lib/events";
import { getAccentColor, STORAGE_KEY } from "../lib/theme";
import "./RecordingOverlay.css";

export type OverlayState = "recording" | "transcribing" | "llm" | "rewrite";

type OverlayErrorEvent = { code?: string; message?: string };

// Skill confirmation event payload
type SkillConfirmationEvent = {
  skill_id: string;
  skill_name: string;
  transcription: string;
  polish_result?: string;
  app_name?: string;
  selected_text_len?: number;
  selected_text_preview?: string;
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

interface RecordingOverlayProps {
  initialState: OverlayState;
}

const EMPTY_LEVELS = Array(16).fill(0);
const WAVEFORM_POINTS = 17;
const WAVEFORM_CENTER_INDEX = Math.floor(WAVEFORM_POINTS / 2);
const EMPTY_WAVEFORM = Array(WAVEFORM_POINTS).fill(0);
const WAVEFORM_HISTORY_LENGTH = WAVEFORM_CENTER_INDEX + 4;
const EMPTY_WAVEFORM_HISTORY = Array(WAVEFORM_HISTORY_LENGTH).fill(0);
const WAVEFORM_HEADROOM = 0.68;
const WAVEFORM_DISTANCE_DECAY = 0.98;
const WAVEFORM_CENTER_ATTACK = 0.7;
const WAVEFORM_CENTER_RELEASE = 0.45;
// Adaptive gain: baseline tracks the recent average loudness so the
// waveform shows *relative* volume changes rather than absolute level.
const AGC_BASELINE_RISE = 0.012; // baseline rises slowly to match sustained loud speech
const AGC_BASELINE_FALL = 0.06; // baseline drops faster when speech gets quieter
const AGC_MIN_BASELINE = 0.06; // floor so silence still reads as silence
const AGC_HEADROOM_RATIO = 1.6; // how much above baseline counts as "full scale"

const RecordingOverlay: React.FC<RecordingOverlayProps> = ({
  initialState,
}) => {
  const { t } = useTranslation();
  // isVisible is implicitly true if we are mounted
  const [state, setState] = useState<OverlayState>(initialState);
  const [rewriteCount, setRewriteCount] = useState<number>(0);
  const [operationText, setOperationText] = useState<string>("");
  const [levels, setLevels] = useState<number[]>(EMPTY_LEVELS.slice(0, 9));
  const [waveform, setWaveform] = useState<number[]>(EMPTY_WAVEFORM);
  const [accentColor, setAccentColor] = useState<string>(getAccentColor);
  const [realtimeText, setRealtimeText] = useState<string>("");
  const [realtimeIsFinal, setRealtimeIsFinal] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [chainedPromptName, setChainedPromptName] = useState<string>("");
  const [skillConfirmation, setSkillConfirmation] =
    useState<SkillConfirmationEvent | null>(null);
  // Multi-model post-process progress tracking
  const [multiModelProgress, setMultiModelProgress] = useState<
    Record<
      string,
      {
        label: string;
        status: "pending" | "processing" | "done" | "error";
        text?: string;
      }
    >
  >({});
  // Track which button is focused for keyboard navigation: 'accept' or 'reject'
  const [focusedButton, setFocusedButton] = useState<"accept" | "reject">(
    "accept",
  );
  const [showTimeout, setShowTimeout] = useState(false);
  const [timeoutFocused, setTimeoutFocused] = useState<
    "continue" | "retry" | "cancel"
  >("continue");
  const smoothedLevelsRef = useRef<number[]>(EMPTY_LEVELS.slice());
  const realtimeScrollRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<OverlayState>(initialState);
  const allowNonFinalRef = useRef<boolean>(true);
  const finalLockedRef = useRef<boolean>(false);
  const waveformRef = useRef<number[]>(EMPTY_WAVEFORM);
  const waveformHistoryRef = useRef<number[]>(EMPTY_WAVEFORM_HISTORY);
  const amplitudeEnvelopeRef = useRef(0);
  const agcBaselineRef = useRef(AGC_MIN_BASELINE);
  const animatedEllipsis = useAnimatedEllipsis(
    state === "recording" && realtimeText.trim().length > 0 && !realtimeIsFinal,
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resetOverlayRecordingState = () => {
    finalLockedRef.current = false;
    allowNonFinalRef.current = true;
    smoothedLevelsRef.current = EMPTY_LEVELS.slice();
    waveformRef.current = EMPTY_WAVEFORM;
    waveformHistoryRef.current = EMPTY_WAVEFORM_HISTORY;
    amplitudeEnvelopeRef.current = 0;
    agcBaselineRef.current = AGC_MIN_BASELINE;
    setLevels(EMPTY_LEVELS.slice(0, 9));
    setWaveform(EMPTY_WAVEFORM);
    setRealtimeText("");
    setRealtimeIsFinal(false);
    setErrorText("");
    setChainedPromptName("");
    setSkillConfirmation(null);
    setOperationText("");
  };

  // If initial state changes (unlikely if unmounted, but good practice)
  useEffect(() => {
    setState(initialState);
    stateRef.current = initialState;
    if (initialState === "recording") {
      resetOverlayRecordingState();
    }
  }, [initialState]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const setupEventListeners = async () => {
      const unlistenError = await listen<OverlayErrorEvent>(
        "overlay-error",
        (event) => {
          const payload = (event.payload ?? {}) as OverlayErrorEvent;

          if (payload.message) {
            setErrorText(payload.message);
            return;
          }

          if (payload.code) {
            // Map backend error codes to translation keys
            const errorMap: Record<string, string> = {
              transcription_failed_saved:
                "overlay.error.transcriptionFailedSaved",
              llm_init_failed: "overlay.error.llmInitFailed",
              llm_request_failed: "overlay.error.llmRequestFailed",
              llm_network_error: "overlay.error.llmNetworkError",
              llm_rate_limited: "overlay.error.llmRateLimited",
              llm_auth_failed: "overlay.error.llmAuthFailed",
              llm_api_error: "overlay.error.llmApiError",
              llm_parse_error: "overlay.error.llmParseError",
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
        },
      );
      if (disposed) {
        unlistenError();
        return;
      }
      unlisteners.push(unlistenError);

      // Listen for mic-level updates — log every frame to terminal
      let micLevelCount = 0;
      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload as number[];
        micLevelCount++;

        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = newLevels[i] || 0;
          return prev * 0.7 + target * 0.3;
        });
        const visibleLevels = smoothed.slice(0, 9);
        const maxLevel = visibleLevels.reduce(
          (max, value) => Math.max(max, value),
          0,
        );
        const avgLevel =
          visibleLevels.reduce((sum, value) => sum + value, 0) /
          Math.max(visibleLevels.length, 1);
        // Raw amplitude from mic levels
        const rawAmplitude = Math.max(0, maxLevel * 0.65 + avgLevel * 0.35);

        // Adaptive gain control: track a slow-moving baseline of the
        // recent loudness so the display shows relative fluctuations.
        const prevBaseline = agcBaselineRef.current;
        const baselineRate =
          rawAmplitude > prevBaseline ? AGC_BASELINE_RISE : AGC_BASELINE_FALL;
        const nextBaseline = Math.max(
          AGC_MIN_BASELINE,
          prevBaseline + (rawAmplitude - prevBaseline) * baselineRate,
        );
        agcBaselineRef.current = nextBaseline;

        // Normalize: how far above the baseline is the current amplitude?
        const ceiling = nextBaseline * AGC_HEADROOM_RATIO;
        const normalized = Math.min(
          1,
          Math.max(0, (rawAmplitude - nextBaseline * 0.3) / ceiling),
        );
        const currentAmplitude = normalized * WAVEFORM_HEADROOM;
        const previousEnvelope = amplitudeEnvelopeRef.current;
        const nextEnvelope =
          currentAmplitude >= previousEnvelope
            ? previousEnvelope * (1 - WAVEFORM_CENTER_ATTACK) +
              currentAmplitude * WAVEFORM_CENTER_ATTACK
            : previousEnvelope * (1 - WAVEFORM_CENTER_RELEASE) +
              currentAmplitude * WAVEFORM_CENTER_RELEASE;

        const nextHistory = [nextEnvelope, ...waveformHistoryRef.current].slice(
          0,
          WAVEFORM_HISTORY_LENGTH,
        );
        const nextWaveform = EMPTY_WAVEFORM.slice();

        for (let i = 0; i < WAVEFORM_POINTS; i += 1) {
          const distance = Math.abs(i - WAVEFORM_CENTER_INDEX);
          const near =
            nextHistory[Math.min(distance, nextHistory.length - 1)] ?? 0;
          const far =
            nextHistory[Math.min(distance + 1, nextHistory.length - 1)] ?? 0;
          const centerWeight = Math.max(0, 1 - distance * 0.08);
          const propagated =
            (near * 0.82 + far * 0.18) *
            Math.pow(WAVEFORM_DISTANCE_DECAY, distance);
          nextWaveform[i] = Math.min(
            0.76,
            propagated * (1 + centerWeight * 0.18),
          );
        }

        smoothedLevelsRef.current = smoothed;
        waveformRef.current = nextWaveform;
        waveformHistoryRef.current = nextHistory;
        amplitudeEnvelopeRef.current = nextEnvelope;
        setLevels(visibleLevels);
        setWaveform(nextWaveform);
      });
      if (disposed) {
        unlistenLevel();
        return;
      }
      unlisteners.push(unlistenLevel);

      const unlistenRealtimePartial = await listen<{ text: string }>(
        "realtime-partial",
        (event) => {
          if (stateRef.current !== "recording") {
            return;
          }
          if (finalLockedRef.current || !allowNonFinalRef.current) {
            return;
          }

          const text = (event.payload.text || "").trim();
          setRealtimeText(text);
          setRealtimeIsFinal(false);
        },
      );
      if (disposed) {
        unlistenRealtimePartial();
        return;
      }
      unlisteners.push(unlistenRealtimePartial);

      const unlistenPostProcessStatus = await listen<string>(
        "post-process-status",
        (event) => {
          setChainedPromptName(event.payload);
        },
      );
      if (disposed) {
        unlistenPostProcessStatus();
        return;
      }
      unlisteners.push(unlistenPostProcessStatus);

      const unlistenStateUpdate = await listen("show-overlay", (event) => {
        // Payload can be a plain string (for most states) or an object
        // { state: "rewrite", rewrite_count: N } for voice rewrite.
        let overlayState: OverlayState;
        if (
          event.payload !== null &&
          typeof event.payload === "object" &&
          "state" in (event.payload as object)
        ) {
          const richPayload = event.payload as {
            state: OverlayState;
            rewrite_count?: number;
          };
          overlayState = richPayload.state;
          if (richPayload.rewrite_count !== undefined) {
            setRewriteCount(richPayload.rewrite_count);
          } else if (overlayState === "recording") {
            setRewriteCount(0);
          }
        } else {
          overlayState = event.payload as OverlayState;
          // Plain string payload has no rewrite_count — reset badge for normal recordings
          if (overlayState === "recording") {
            setRewriteCount(0);
          }
        }
        setState(overlayState);
        // Reset buffer if restarting recording
        if (overlayState === "recording") {
          resetOverlayRecordingState();
          setShowTimeout(false);
        }
      });
      if (disposed) {
        unlistenStateUpdate();
        return;
      }
      unlisteners.push(unlistenStateUpdate);

      const unlistenRewriteOperation = await listen<{ operation: string }>(
        "rewrite-operation-complete",
        (event) => {
          const op = event.payload.operation || "unknown";
          setOperationText(t(`overlay.rewriteOperation.${op}`, t("overlay.rewriteOperation.unknown")));
        },
      );
      if (disposed) {
        unlistenRewriteOperation();
        return;
      }
      unlisteners.push(unlistenRewriteOperation);

      // Listen for skill confirmation requests (selected text scenario)
      const unlistenSkillConfirmation = await listen<SkillConfirmationEvent>(
        "skill-confirmation",
        (event) => {
          console.log("[SkillConfirmation] Received event:", event.payload);
          setSkillConfirmation(event.payload);
          setFocusedButton("accept"); // Default to accept button
          // Request focus after a short delay to ensure UI is rendered
          setTimeout(() => {
            invoke("focus_overlay").catch((e) =>
              console.warn("Failed to focus overlay:", e),
            );
          }, 50);
        },
      );
      if (disposed) {
        unlistenSkillConfirmation();
        return;
      }
      unlisteners.push(unlistenSkillConfirmation);

      // Listen for multi-model post-process start
      const unlistenMultiModelStart = await listen<{
        items: { id: string; label: string }[];
      }>("multi-post-process-start", (event) => {
        const progress: typeof multiModelProgress = {};
        event.payload.items.forEach((item) => {
          progress[item.id] = { label: item.label, status: "pending" };
        });
        setMultiModelProgress(progress);
      });
      if (disposed) {
        unlistenMultiModelStart();
        return;
      }
      unlisteners.push(unlistenMultiModelStart);

      // Listen for multi-model post-process progress
      const unlistenMultiModelProgress = await listen<{
        id: string;
        status: "processing" | "done" | "error";
        text?: string;
      }>("multi-post-process-progress", (event) => {
        setMultiModelProgress((prev) => ({
          ...prev,
          [event.payload.id]: {
            ...prev[event.payload.id],
            status: event.payload.status,
            text: event.payload.text,
          },
        }));
      });
      if (disposed) {
        unlistenMultiModelProgress();
        return;
      }
      unlisteners.push(unlistenMultiModelProgress);

      // Listen for multi-model post-process complete
      const unlistenMultiModelComplete = await listen(
        "multi-post-process-complete",
        () => {
          // Keep results visible until user selects
        },
      );
      if (disposed) {
        unlistenMultiModelComplete();
        return;
      }
      unlisteners.push(unlistenMultiModelComplete);

      // Listen for ASR online timeout
      const unlistenTimeout = await listen<{ has_local_fallback: boolean }>(
        ASR_ONLINE_TIMEOUT,
        (event) => {
          if (!event.payload.has_local_fallback) {
            setShowTimeout(true);
            setTimeoutFocused("continue");
            setTimeout(() => {
              invoke("focus_overlay").catch(() => {});
            }, 50);
          }
        },
      );
      if (disposed) {
        unlistenTimeout();
        return;
      }
      unlisteners.push(unlistenTimeout);

      // Listen for theme changes from localStorage (when main app changes theme)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
          setAccentColor(getAccentColor());
        }
      };

      window.addEventListener("storage", handleStorageChange);
      unlisteners.push(() =>
        window.removeEventListener("storage", handleStorageChange),
      );
    };

    void setupEventListeners();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners.splice(0)) {
        unlisten();
      }
    };
  }, []); // Run once on mount

  // Keyboard navigation for skill confirmation
  useEffect(() => {
    if (!skillConfirmation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Arrow keys to switch between buttons
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocusedButton((prev) => (prev === "accept" ? "reject" : "accept"));
        return;
      }

      // Enter to confirm current selection
      if (e.key === "Enter") {
        e.preventDefault();
        const accepted = e.metaKey || e.ctrlKey || focusedButton === "accept";
        invoke("confirm_skill", {
          skillId: skillConfirmation.skill_id,
          accepted,
        });
        setSkillConfirmation(null);
        return;
      }

      // Escape to cancel (reject skill, use polish result)
      if (e.key === "Escape") {
        e.preventDefault();
        invoke("confirm_skill", {
          skillId: skillConfirmation.skill_id,
          accepted: false,
        });
        setSkillConfirmation(null);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [skillConfirmation, focusedButton]);

  // Keyboard navigation for ASR timeout prompt
  useEffect(() => {
    if (!showTimeout) return;

    const buttons = ["continue", "retry", "cancel"] as const;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setTimeoutFocused((prev) => {
          const idx = buttons.indexOf(prev);
          const next =
            e.key === "ArrowRight"
              ? (idx + 1) % buttons.length
              : (idx - 1 + buttons.length) % buttons.length;
          return buttons[next];
        });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        invoke("respond_asr_timeout", { action: timeoutFocused });
        setShowTimeout(false);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        invoke("respond_asr_timeout", { action: "cancel" });
        setShowTimeout(false);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showTimeout, timeoutFocused]);

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

  const isRewriteMode = rewriteCount > 0;

  const getIcon = () => {
    if (Boolean(errorText) && state !== "recording") {
      return <CancelIcon color="var(--ruby-9)" />;
    }
    if (isRewriteMode) {
      return (
        <Box className="rewrite-badge">
          <Text className="rewrite-badge-number">{rewriteCount}</Text>
        </Box>
      );
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
    rewrite: t("overlay.status.rewrite"),
  };

  const realtimeDisplayText =
    state === "recording" && !realtimeIsFinal
      ? `${stripTrailingSentencePunctuation(realtimeText)}${animatedEllipsis}`.trim()
      : realtimeText;

  const showRealtimeText =
    realtimeDisplayText.length > 0 &&
    state === "recording" &&
    !skillConfirmation;
  const showErrorText = Boolean(errorText) && state !== "recording";

  return (
    <Box className="overlay-root">
      <Box
        className={`recording-overlay fade-in ${
          showRealtimeText ? "has-realtime" : ""
        } ${skillConfirmation ? "has-skill-confirm" : ""}`}
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
              <Flex className="waveform-container">
                <Box className="waveform-axis" />
                {waveform.map((value, i) => {
                  const distance = Math.abs(i - WAVEFORM_CENTER_INDEX);
                  const centerBoost = Math.max(0, 1 - distance * 0.075);
                  const displayValue = Math.min(
                    0.82,
                    value * (1 + centerBoost * 0.18),
                  );
                  const height =
                    displayValue < 0.035
                      ? 0
                      : 1 + Math.pow(displayValue, 0.96) * 22;
                  const opacity = Math.max(
                    0,
                    Math.min(1, 0.22 + displayValue * 0.5 - distance * 0.025),
                  );
                  const isCenter = i === WAVEFORM_CENTER_INDEX;
                  const className = isCenter
                    ? "waveform-segment waveform-segment-center"
                    : "waveform-segment";

                  return (
                    <Box
                      key={i}
                      className={className}
                      style={{
                        height: `${height}px`,
                        opacity,
                      }}
                    />
                  );
                })}
              </Flex>
            </>
          )}
          {!showRealtimeText && state !== "recording" && !skillConfirmation && (
            <Flex direction="column" className="status-text" align="center">
              {!showErrorText && (
                <Text>
                  {operationText || chainedPromptName || statusTextMap[state]}
                </Text>
              )}
              {showErrorText && (
                <Text style={{ color: "var(--ruby-9)", fontWeight: "bold" }}>
                  {errorText}
                </Text>
              )}
            </Flex>
          )}

          {/* ASR Timeout UI */}
          {showTimeout && state === "transcribing" && (
            <Flex
              direction="column"
              align="center"
              gap="2"
              className="timeout-prompt"
            >
              <Text className="timeout-title">
                {t("overlay.timeout.title")}
              </Text>
              <Flex gap="2" className="timeout-buttons">
                {(["continue", "retry", "cancel"] as const).map((action) => (
                  <button
                    key={action}
                    className={`timeout-btn ${timeoutFocused === action ? "focused" : ""}`}
                    onClick={() => {
                      invoke("respond_asr_timeout", { action });
                      setShowTimeout(false);
                    }}
                  >
                    {t(`overlay.timeout.${action}`)}
                  </button>
                ))}
              </Flex>
            </Flex>
          )}

          {/* Skill Confirmation UI */}
          {skillConfirmation && (
            <Flex
              direction="column"
              className="skill-confirmation"
              align="center"
              gap="2"
            >
              {/* Prompt + skill name + confirm text — tight group */}
              <Flex
                direction="column"
                align="center"
                className="skill-confirm-prompt"
              >
                <Text className="prompt-text">
                  {t("overlay.skillConfirmation.detectedSelection")}
                </Text>
                <Text className="skill-name">
                  {skillConfirmation.skill_name}
                </Text>
                <Text className="prompt-text">
                  {t("overlay.skillConfirmation.confirmUse")}
                </Text>
              </Flex>

              {/* Buttons */}
              <Flex className="confirm-buttons" justify="center" gap="2">
                <Box
                  className={`confirm-button accept ${focusedButton === "accept" ? "focused" : ""}`}
                  onClick={() => {
                    invoke("confirm_skill", {
                      skillId: skillConfirmation.skill_id,
                      accepted: true,
                    });
                    setSkillConfirmation(null);
                  }}
                >
                  {t("common.confirm")} (Enter)
                </Box>
                <Box
                  className={`confirm-button reject ${focusedButton === "reject" ? "focused" : ""}`}
                  onClick={() => {
                    invoke("confirm_skill", {
                      skillId: skillConfirmation.skill_id,
                      accepted: false,
                    });
                    setSkillConfirmation(null);
                  }}
                >
                  {t("common.cancel")} (Esc)
                </Box>
              </Flex>

              {/* Selected content mini-window */}
              {skillConfirmation.selected_text_len != null && (
                <Box className="skill-content-window">
                  <Flex
                    className="skill-content-titlebar"
                    align="center"
                    gap="1"
                  >
                    <Box className="skill-content-close">✕</Box>
                    <Text className="skill-content-app">
                      {skillConfirmation.app_name || "—"}
                    </Text>
                    <Text className="skill-content-sep">·</Text>
                    <Text className="skill-content-count">
                      {t("overlay.skillConfirmation.charCount", {
                        count: skillConfirmation.selected_text_len,
                      })}
                    </Text>
                  </Flex>
                  {skillConfirmation.selected_text_preview && (
                    <Box className="skill-content-body">
                      <Text className="skill-content-text">
                        {skillConfirmation.selected_text_preview}
                      </Text>
                    </Box>
                  )}
                </Box>
              )}
            </Flex>
          )}
        </Flex>

        <Flex className="overlay-right" />
      </Box>
    </Box>
  );
};

export default RecordingOverlay;
