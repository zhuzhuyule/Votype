# Votype

**A free, open source, and extensible speech-to-text application that works completely offline.**

Votype is a cross-platform desktop application built with Tauri (Rust + React/TypeScript) that provides simple, privacy-focused speech transcription. It allows users to press a shortcut, speak, and have their words appear in any text field without sending voice data to the cloud.

## Project Overview

*   **Project Name:** Votype
*   **Core Functionality:** Offline speech-to-text transcription using local models (Whisper, Parakeet).
*   **Architecture:**
    *   **Frontend:** React (v18), TypeScript, Vite, Tailwind CSS (v4), Zustand, Radix UI Themes.
    *   **Backend:** Tauri v2 (Rust), handling audio recording (`cpal`), VAD (`vad-rs`), and inference (`whisper-rs`, `transcribe-rs`, `sherpa-rs-sys`).
*   **Platforms:** macOS, Windows, Linux (x64).

## Building and Running

The project uses **Bun** as the preferred package manager.

### Prerequisites

*   **Rust:** Latest stable version (`rustup`).
*   **Bun:** [Install Bun](https://bun.sh/).
*   **System Dependencies:**
    *   **macOS:** Xcode Command Line Tools (`xcode-select --install`).
    *   **Windows:** Visual Studio C++ Build Tools.
    *   **Linux:** `build-essential`, `libasound2-dev`, `libwebkit2gtk-4.1-dev`, etc. (See `BUILD.md` for full list).

### Development Commands

| Command | Description |
| :--- | :--- |
| `bun install` | Install frontend dependencies. |
| `bun tauri dev` | Start the application in development mode with hot-reloading. |
| `bun tauri build` | Build the optimized application bundle/installer for production. |
| `bun run format` | Format both frontend (Prettier) and backend (Rustfmt) code. |
| `bun run format:check` | Check code formatting without applying changes. |

### Key Files & Directories

*   **`src/`**: React frontend source code.
    *   `App.tsx`: Main application component.
    *   `overlay/`: Source for the recording overlay window.
    *   `stores/`: Zustand state management.
*   **`src-tauri/`**: Rust backend source code.
    *   `Cargo.toml`: Rust dependencies.
    *   `tauri.conf.json`: Tauri configuration (app identifier, windows, permissions).
    *   `src/lib.rs`: Main library entry point.
    *   `src/managers/`: Logic for audio, history, models, and transcription.
*   **`BUILD.md`**: Detailed build instructions and troubleshooting.
*   **`README.md`**: General project documentation.

## Development Conventions

*   **State Management:** uses `zustand` for global state in the React frontend.
*   **Styling:** uses `tailwindcss` v4.
*   **Permissions:** Tauri v2 capability system is used. Modify `src-tauri/capabilities/` when adding new plugin permissions.
*   **Audio Pipeline:** The backend manages audio input via `cpal`, detects voice activity with `vad-rs` (Silero), and processes audio with various engines (`whisper-rs`, `transcribe-rs`).
*   **Formatting:** Run `bun run format` before committing to ensure code style consistency.

- 所有的回复始终都是用中文