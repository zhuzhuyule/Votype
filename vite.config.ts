import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Multiple entry points for main app, overlay, and review window
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "src/overlay/index.html"),
        review: resolve(__dirname, "src/review/index.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (id.includes("highlight.js")) {
            return "vendor-highlight";
          }

          if (id.includes("@tiptap")) {
            return "vendor-tiptap";
          }

          if (
            id.includes("prosemirror") ||
            id.includes("/orderedmap/") ||
            id.includes("/w3c-keyname/")
          ) {
            return "vendor-prosemirror";
          }

          if (
            id.includes("@radix-ui") ||
            id.includes("tailwindcss") ||
            id.includes("@tailwindcss")
          ) {
            return "vendor-ui";
          }

          if (
            id.includes("react-i18next") ||
            id.includes("i18next") ||
            id.includes("react-markdown")
          ) {
            return "vendor-content";
          }

          if (
            id.includes("@tauri-apps") ||
            id.includes("zustand") ||
            id.includes("sonner") ||
            id.includes("zod")
          ) {
            return "vendor-app";
          }

          if (id.includes("@iconify") || id.includes("@tabler")) {
            return "vendor-icons";
          }

          if (id.includes("react") || id.includes("scheduler")) {
            return "vendor-react";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
