# Votype Project Context                                                 
                                                                         
## Project Overview                                                      
                                                                         
**Votype** (formerly Handy) is a cross-platform, offline speech-to-text  
desktop application built with **Tauri**. It allows users to transcribe  
speech directly into any text field using global shortcuts, ensuring     
privacy by processing audio locally.                                     
                                                                         
### Key Features                                                         
*   **Offline First:** Uses local models (Whisper, Parakeet) for         
transcription.                                                           
*   **Cross-Platform:** Runs on macOS, Windows, and Linux.               
*   **Privacy Focused:** Audio is processed locally; no data is sent to  
the cloud.                                                               
*   **Global Shortcuts:** Trigger recording/transcription from anywhere  
in the OS.                                                               
                                                                         
## Architecture & Tech Stack                                             
                                                                         
The project follows the standard Tauri architecture:                     
                                                                         
### Frontend (`src/`)                                                    
*   **Framework:** React (v18) + TypeScript.                             
*   **Build Tool:** Vite.                                                
*   **Styling:** Tailwind CSS (v4).                                      
*   **State Management:** Zustand.                                       
*   **UI Components:** Radix UI Themes.                                  
*   **Internationalization:** i18next.                                   
                                                                         
### Backend (`src-tauri/`)                                               
*   **Framework:** Tauri v2 (Rust).                                      
*   **Audio Processing:**                                                
    *   `cpal`: Cross-platform audio input/output.                       
    *   `vad-rs`: Voice Activity Detection (Silero).                     
    *   `rubato`: Audio resampling.                                      
    *   `hound`: WAV encoding/decoding.                                  
*   **Machine Learning / ASR:**                                          
    *   `whisper-rs`: Bindings for OpenAI's Whisper models.              
    *   `transcribe-rs`: CPU-optimized Parakeet models.                  
    *   `sherpa-rs-sys`: Bindings for Sherpa (likely for additional      
model support).                                                          
*   **System Integration:**                                              
    *   `rdev`: Global keyboard shortcuts and mouse events.              
    *   `enigo`: Cross-platform input simulation (for pasting text).     
    *   `active-win-pos-rs`: Active window detection.                    
    *   `tauri-plugin-clipboard-manager`: Clipboard access.              
                                                                         
## Development Setup                                                     
                                                                         
**Prerequisites:**                                                       
*   **Rust:** Latest stable version (`rustup`).                          
*   **Node.js / Bun:** The project uses **Bun** as the preferred package 
manager (see `tauri.conf.json` and `BUILD.md`), though `npm` lockfiles   
exist.                                                                   
*   **Platform-specific build tools:** Xcode Command Line Tools (macOS), 
Visual Studio C++ Build Tools (Windows), `build-essential` & audio libs  
(Linux).                                                                 
                                                                         
### Key Commands                                                         
                                                                         
| Action | Command | Description |                                       
| :--- | :--- | :--- |                                                   
| **Install Dependencies** | `bun install` | Install frontend            
dependencies. |                                                          
| **Start Dev Server** | `bun tauri dev` | Starts the Tauri app in       
development mode with hot-reloading. |                                   
| **Build Production** | `bun tauri build` | Builds the optimized        
application bundle / installer. |                                        
| **Format Code** | `npm run format` | Runs Prettier for frontend and    
`cargo fmt` for backend. |                                               
| **Frontend Format** | `npm run format:frontend` | Runs Prettier on     
`src/`. |                                                                
| **Backend Format** | `npm run format:backend` | Runs `cargo fmt` in    
`src-tauri/`. |                                                          
                                                                         
## Directory Structure                                                   
                                                                         
*   **`src/`**: React frontend application.                              
    *   `applets/`: Specialized UI modules (e.g., notebook).             
    *   `components/`: Reusable UI components.                           
    *   `hooks/`: Custom React hooks (e.g., `useModels`, `useSettings`). 
    *   `stores/`: Zustand state stores.                                 
    *   `lib/`: Utilities and type definitions.                          
    *   `overlay/`: Separate entry point for the recording overlay       
window.                                                                  
*   **`src-tauri/`**: Rust backend.                                      
    *   `src/`: Rust source code.                                        
        *   `main.rs`: Entry point.                                      
        *   `sherpa.rs`, `online_asr.rs`: ASR logic.                     
        *   `tray.rs`: System tray implementation.                       
    *   `capabilities/`: Tauri permission configurations.                
    *   `resources/`: Bundled assets (icons, sounds, default models).    
    *   `tauri.conf.json`: Main Tauri configuration file.                
                                                                         
## Development Conventions                                               
                                                                         
*   **Package Manager:** Prefer `bun` for running scripts and installing 
packages, but respect `package-lock.json` if `bun.lock` is out of sync   
or if explicitly required.                                               
*   **Code Style:**                                                      
    *   **Frontend:** Prettier + ESLint.                                 
    *   **Backend:** Rust standard style (`rustfmt`).                    
*   **Commits:** Follow conventional commits if possible (not explicitly 
enforced but good practice).                                             
*   **Permissions:** Tauri v2 uses a capability-based permission system  
(`src-tauri/capabilities/`). New plugin usage usually requires updating  
these files.         