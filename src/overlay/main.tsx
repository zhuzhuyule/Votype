import { Box } from "@radix-ui/themes";
import { listen } from "@tauri-apps/api/event";
import React, { Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../i18n";
import { OverlayState } from "./RecordingOverlay";

// Lazy load the heavy overlay component
const RecordingOverlay = React.lazy(() => import("./RecordingOverlay"));

const OverlayApp: React.FC = () => {
  const [mounted, setMounted] = useState(false);
  const [initialState, setInitialState] = useState<OverlayState>("recording");

  useEffect(() => {
    // Listen for show/hide events from Rust to control lifecycle
    const unlistenShow = listen("show-overlay", (event) => {
      const state = event.payload as OverlayState;
      setInitialState(state);
      setMounted(true);
    });

    const unlistenHide = listen("hide-overlay", () => {
      setMounted(false);
      setTimeout(() => {
        window.location.reload();
      }, 10);
    });

    return () => {
      unlistenShow.then((f) => f());
      unlistenHide.then((f) => f());
    };
  }, []);

  return mounted ? (
    <Suspense fallback={<Box className="overlay-root" />}>
      <RecordingOverlay initialState={initialState} />
    </Suspense>
  ) : null;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
);
