import { Box } from "@radix-ui/themes";
import { listen } from "@tauri-apps/api/event";
import React, { Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { ErrorBoundary } from "../components/ErrorBoundary";
import i18n from "../i18n";
import { OverlayState } from "./RecordingOverlay";

// Lazy load the heavy overlay component
const RecordingOverlay = React.lazy(() => import("./RecordingOverlay"));

const OverlayApp: React.FC = () => {
  const [initialState, setInitialState] = useState<OverlayState>("recording");

  useEffect(() => {
    // Keep the overlay app mounted so the first recording event cannot be missed.
    const unlistenShow = listen("show-overlay", (event) => {
      const state = event.payload as OverlayState;
      setInitialState(state);
    });

    return () => {
      unlistenShow.then((f) => f());
    };
  }, []);

  return (
    <ErrorBoundary>
      <Suspense fallback={<Box className="overlay-root" />}>
        <RecordingOverlay initialState={initialState} />
      </Suspense>
    </ErrorBoundary>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <OverlayApp />
    </I18nextProvider>
  </React.StrictMode>,
);
