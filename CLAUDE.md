# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Votype application is a cross-platform desktop application built with the Tauri framework for speech-to-text transcription with a focus on efficiency, privacy, and system integration.

## Architecture

The application adopts a hybrid architecture:
- **Frontend (`src/`)**: Web-based UI using React, TypeScript, and Vite
- **Backend (`src-tauri/`)**: Rust application handling system-level operations and native APIs

### Frontend-Backend Communication
- Frontend calls backend using Tauri's `invoke` mechanism: `import { invoke } from '@tauri-apps/api/core'`
- Backend commands are defined with `#[tauri::command]` attribute and registered in `src-tauri/src/lib.rs`
- Backend emits events to frontend using `app.emit("event-name", payload)`

### Key Technologies
**Frontend:**
- React 18, TypeScript, Vite 6
- Radix UI for accessible components, styled with Tailwind CSS 4
- Zustand for state management
- Sonner for notifications, Zod for validation

**Backend:**
- Rust with Tauri 2.x framework
- Tauri plugins for native functionality (autostart, clipboard, filesystem, global shortcuts, etc.)
- Audio processing: `cpal`, `vad-rs`, `rubato`
- Speech-to-text: `transcribe-rs`, `async-openai`

## Project Structure

- `src/`: Frontend source
  - `src/components/`: UI components with `src/components/ui/` for primitives
  - `src/hooks/`, `src/stores/`: React hooks and Zustand stores
  - `src/lib/`: Utility functions
- `src-tauri/`: Rust backend
  - `src-tauri/src/`: Rust modules (commands, managers)
  - `src-tauri/tauri.conf.json`: Tauri configuration
  - `src-tauri/Cargo.toml`: Rust dependencies

## Development Commands

- `bun dev`: Start frontend development server
- `bun tauri dev`: Run Tauri app in development mode
- `bun build`: Build frontend
- `bun tauri build`: Build production Tauri desktop app
- `bun preview`: Preview built frontend assets
- `bun format`: Format both frontend and backend code
- `bun format:frontend`: Format frontend only
- `bun format:backend`: Format backend only

## Core Functionality

- **Speech-to-Text**: Local transcription using various models
- **Audio Management**: Microphone input/output device control
- **Model Management**: Download, delete, and select STT models
- **History**: Transcription history stored in SQLite database
- **Global Shortcuts**: Configurable hotkeys for transcription control
- **System Tray**: Application runs in system tray
- **Settings System**: Comprehensive configuration options
- **Overlay**: Visual indicator during recording

## UI Architecture

- Component-based using React functional components
- Built on Radix UI primitives with Tailwind CSS styling
- Zustand stores for global state management
- Focus on accessibility and reusability