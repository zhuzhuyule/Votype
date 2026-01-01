import { Box } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "../App.css";
import { RadixThemeProvider } from "../components/theme/RadixThemeProvider";
import "../i18n";
import ReviewWindow from "./ReviewWindow";

interface ReviewData {
  source_text: string;
  final_text: string;
  change_percent: number;
  history_id: number | null;
  reason?: string | null;
  output_mode?: "polish" | "chat";
}

interface ReviewHidePayload {
  history_id: number | null;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ReviewWindow crashed:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box
          style={{
            padding: 20,
            color: "red",
            background: "rgba(255,255,255,0.9)",
            borderRadius: 8,
            maxWidth: 400,
            margin: "20px auto",
          }}
        >
          <h3>Something went wrong.</h3>
          <pre style={{ fontSize: 11, overflow: "auto" }}>
            {this.state.error?.toString()}
          </pre>
        </Box>
      );
    }
    return this.props.children;
  }
}

const ReviewApp: React.FC = () => {
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const reviewDataRef = useRef<ReviewData | null>(null);

  useEffect(() => {
    reviewDataRef.current = reviewData;
  }, [reviewData]);

  useEffect(() => {
    let unlistenShow: (() => void) | null = null;
    let unlistenHide: (() => void) | null = null;

    const setupListeners = async () => {
      // Listen for show event from Rust
      unlistenShow = await listen<ReviewData>("review-window-show", (event) => {
        setReviewData(event.payload);
      });

      // Listen for hide event from Rust
      unlistenHide = await listen<ReviewHidePayload>(
        "review-window-hide",
        (event) => {
          const activeReview = reviewDataRef.current;
          const payloadHistoryId = event.payload?.history_id ?? null;
          const shouldHide =
            !activeReview || activeReview.history_id === payloadHistoryId;

          if (shouldHide) {
            setReviewData(null);
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
    };
  }, []);

  useEffect(() => {
    if (!reviewData) {
      void getCurrentWindow().hide();
    }
  }, [reviewData]);

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
          {reviewData ? (
            <ReviewWindow
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
