import { Box } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../App.css";
import { RadixThemeProvider } from "../components/theme/RadixThemeProvider";
import "../i18n";
import ReviewWindow from "./ReviewWindow";

interface ReviewData {
  text: string;
  confidence: number;
  history_id: number | null;
}

const ReviewApp: React.FC = () => {
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);

  useEffect(() => {
    let unlistenShow: (() => void) | null = null;
    let unlistenHide: (() => void) | null = null;

    const setupListeners = async () => {
      // Listen for show event from Rust
      unlistenShow = await listen<ReviewData>("review-window-show", (event) => {
        setReviewData(event.payload);
      });

      // Listen for hide event from Rust
      unlistenHide = await listen("review-window-hide", () => {
        setReviewData(null);
      });

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

  return (
    <RadixThemeProvider>
      <Box
        style={{
          width: "100vw",
          height: "100vh",
          background: "transparent",
        }}
      >
        {reviewData ? (
          <ReviewWindow
            initialData={reviewData}
            onClose={() => setReviewData(null)}
          />
        ) : (
          <Box className="review-root" />
        )}
      </Box>
    </RadixThemeProvider>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ReviewApp />
  </React.StrictMode>,
);
