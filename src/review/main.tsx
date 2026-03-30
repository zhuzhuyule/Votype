import { Box } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "../App.css";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { RadixThemeProvider } from "../components/theme/RadixThemeProvider";
import "../i18n";
import { MultiModelCandidate } from "./CandidatePanel";
import ReviewWindow from "./ReviewWindow";

interface ReviewData {
  source_text: string;
  final_text: string;
  change_percent: number;
  history_id: number | null;
  reason?: string | null;
  output_mode?: "polish" | "chat";
  skill_name?: string | null;
  prompt_id?: string | null;
  model_id?: string | null;
}

interface MultiModelProgressEvent {
  total: number;
  completed: number;
  results: MultiModelCandidate[];
  done: boolean;
}

interface MultiCandidateData {
  source_text: string;
  candidates: MultiModelCandidate[];
  history_id: number | null;
  output_mode?: "polish" | "chat";
  skill_name?: string;
  prompt_id?: string | null;
}

interface ReviewHidePayload {
  history_id: number | null;
}

const ReviewApp: React.FC = () => {
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [multiCandidateData, setMultiCandidateData] =
    useState<MultiCandidateData | null>(null);
  const reviewDataRef = useRef<ReviewData | null>(null);
  const multiCandidateDataRef = useRef<MultiCandidateData | null>(null);
  const reviewKeyRef = useRef(0); // Counter for forcing re-mount

  useEffect(() => {
    reviewDataRef.current = reviewData;
  }, [reviewData]);

  useEffect(() => {
    multiCandidateDataRef.current = multiCandidateData;
  }, [multiCandidateData]);

  useEffect(() => {
    let unlistenShow: (() => void) | null = null;
    let unlistenHide: (() => void) | null = null;
    let unlistenMultiCandidate: (() => void) | null = null;
    let unlistenMultiProgress: (() => void) | null = null;
    let unlistenRerunReset: (() => void) | null = null;

    const setupListeners = async () => {
      // Ensure window is hidden during reload/mount to avoid white flash
      try {
        await getCurrentWindow().hide();
      } catch (error) {
        console.warn("Failed to hide review window on mount:", error);
      }
      // Listen for show event from Rust
      unlistenShow = await listen<ReviewData>("review-window-show", (event) => {
        reviewKeyRef.current += 1; // Force re-mount on new data
        setReviewData(event.payload);
        setMultiCandidateData(null);
      });

      // Listen for multi-candidate event from Rust
      unlistenMultiCandidate = await listen<MultiCandidateData>(
        "review-window-multi-candidate",
        (event) => {
          reviewKeyRef.current += 1; // Force re-mount on new data
          setMultiCandidateData(event.payload);
          setReviewData(null);
        },
      );

      // Listen for rerun reset — clear parent candidates to loading state
      unlistenRerunReset = await listen<{ candidates: MultiModelCandidate[] }>(
        "multi-model-rerun-reset",
        (event) => {
          setMultiCandidateData((prev) => {
            if (!prev) return prev;
            return { ...prev, candidates: event.payload.candidates };
          });
        },
      );

      // Listen for multi-model progress updates
      unlistenMultiProgress = await listen<MultiModelProgressEvent>(
        "multi-post-process-progress",
        (event) => {
          const progress = event.payload;
          setMultiCandidateData((prev) => {
            if (!prev) return prev;
            // Merge completed results into existing candidates
            const updatedCandidates = prev.candidates.map((candidate) => {
              const completed = progress.results.find(
                (r) => r.id === candidate.id,
              );
              if (completed) {
                return {
                  ...candidate,
                  text: completed.text,
                  confidence: completed.confidence,
                  processing_time_ms: completed.processing_time_ms,
                  error: completed.error,
                  ready: completed.ready ?? true,
                  output_speed: completed.output_speed,
                };
              }
              return candidate;
            });
            return { ...prev, candidates: updatedCandidates };
          });
        },
      );

      // Listen for hide event from Rust
      unlistenHide = await listen<ReviewHidePayload>(
        "review-window-hide",
        (event) => {
          const activeReview = reviewDataRef.current;
          const activeMultiCandidate = multiCandidateDataRef.current;
          const payloadHistoryId = event.payload?.history_id ?? null;
          const shouldHide =
            (!activeReview || activeReview.history_id === payloadHistoryId) &&
            (!activeMultiCandidate ||
              activeMultiCandidate.history_id === payloadHistoryId);

          if (shouldHide) {
            setReviewData(null);
            setMultiCandidateData(null);
            void getCurrentWindow().hide();
          }
        },
      );

      // Signal ready AFTER listeners are set up
      try {
        await invoke("review_window_ready");
      } catch (error) {
        console.error("Failed to mark review window as ready:", error);
      }
    };

    setupListeners();

    return () => {
      if (unlistenShow) unlistenShow();
      if (unlistenHide) unlistenHide();
      if (unlistenMultiCandidate) unlistenMultiCandidate();
      if (unlistenMultiProgress) unlistenMultiProgress();
      if (unlistenRerunReset) unlistenRerunReset();
    };
  }, []);

  useEffect(() => {
    if (!reviewData && !multiCandidateData) {
      void getCurrentWindow().hide();
    }
  }, [reviewData, multiCandidateData]);

  return (
    <RadixThemeProvider>
      <Box
        style={{
          width: "100vw",
          height: "100vh",
          background: "transparent",
        }}
      >
        <ErrorBoundary>
          {multiCandidateData ? (
            <ReviewWindow
              key={`review-${reviewKeyRef.current}`}
              initialData={{
                source_text: multiCandidateData.source_text,
                final_text: multiCandidateData.candidates[0]?.text || "",
                change_percent: 0,
                history_id: multiCandidateData.history_id,
                output_mode: multiCandidateData.output_mode,
                skill_name: multiCandidateData.skill_name,
                prompt_id: multiCandidateData.prompt_id,
              }}
              multiCandidates={multiCandidateData.candidates}
              onClose={() => setMultiCandidateData(null)}
            />
          ) : reviewData ? (
            <ReviewWindow
              key={`review-${reviewKeyRef.current}`}
              initialData={reviewData}
              onClose={() => setReviewData(null)}
            />
          ) : (
            <Box className="review-root" />
          )}
        </ErrorBoundary>
      </Box>
    </RadixThemeProvider>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ReviewApp />
  </React.StrictMode>,
);
