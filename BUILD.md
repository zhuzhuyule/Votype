# Build Instructions

This guide covers how to set up the development environment and build Votype from source across different platforms.

## Prerequisites

### All Platforms

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) package manager
- [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

### Platform-Specific Requirements

#### macOS

- Xcode Command Line Tools
- Install with: `xcode-select --install`

#### Windows

- Microsoft C++ Build Tools
- Visual Studio 2019/2022 with C++ development tools
- Or Visual Studio Build Tools 2019/2022

#### Linux

- Build essentials
- ALSA development libraries
- Install with:

  ```bash
  # Ubuntu/Debian
  sudo apt update
  sudo apt install build-essential libasound2-dev pkg-config libssl-dev libvulkan-dev vulkan-tools glslc libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf cmake

  # Fedora/RHEL
  sudo dnf groupinstall "Development Tools"
  sudo dnf install alsa-lib-devel pkgconf openssl-devel vulkan-devel \
    gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel

  # Arch Linux
  sudo pacman -S base-devel alsa-lib pkgconf openssl vulkan-devel \
    gtk3 webkit2gtk-4.1 libappindicator-gtk3 librsvg
  ```

## Setup Instructions

### 1. Clone the Repository

```bash
git clone git@github.com:zhuzhuyule/Votype.git
cd Votype
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Start Dev Server

```bash
bun tauri dev
```

---

## 🔧 macOS Special Build Requirements

### Why Special Steps Are Needed

Votype uses third-party dynamic libraries (Sherpa-ONNX) that require special handling on macOS:

1. **Third-party dynamic libraries**:
   - ONNX Runtime (`libonnxruntime.1.17.1.dylib`) - 48 MB
   - Sherpa-ONNX libraries - 8.7 MB total

2. **Code signing issue**:
   - These libraries have their own signatures (from official builds)
   - Without Apple Developer ID, we use ad-hoc signing
   - macOS detects Team ID mismatch and refuses to load libraries

3. **Solution**:
   - Copy libraries to app bundle
   - Re-sign entire app with ad-hoc signature
   - This resolves the Team ID conflict

### Quick Build (Recommended)

**For local development/testing (no auto-update):**

```bash
# Simple build without signing
bun tauri build

# Then manually copy libraries and re-sign
BUNDLE="src-tauri/target/release/bundle/macos/Votype.app"
mkdir -p "$BUNDLE/Contents/Frameworks"
cp src-tauri/target/release/libonnxruntime.1.17.1.dylib "$BUNDLE/Contents/Frameworks/"
cp src-tauri/target/release/libsherpa-onnx-cxx-api.dylib "$BUNDLE/Contents/Frameworks/"
cp src-tauri/target/release/libsherpa-onnx-c-api.dylib "$BUNDLE/Contents/Frameworks/"
codesign --force --deep --sign - "$BUNDLE"
```

**For release builds (with auto-update signing):**

```bash
./build-macos.sh
```

This script automatically:

1. Sets Tauri signing environment variables (for auto-update)
2. Runs `bun tauri build`
3. Copies dynamic libraries to `Frameworks/`
4. Re-signs the app

### Manual Build Steps

If you want to build manually:

```bash
# 1. (Optional) Set signing environment variables
# Only needed for release builds with auto-update
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/votype.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="votype2025"

# 2. Build the app
bun tauri build

# 3. Copy dynamic libraries
BUNDLE="src-tauri/target/release/bundle/macos/Votype.app"
mkdir -p "$BUNDLE/Contents/Frameworks"

cp src-tauri/target/release/libonnxruntime.1.17.1.dylib "$BUNDLE/Contents/Frameworks/"
cp src-tauri/target/release/libsherpa-onnx-cxx-api.dylib "$BUNDLE/Contents/Frameworks/"
cp src-tauri/target/release/libsherpa-onnx-c-api.dylib "$BUNDLE/Contents/Frameworks/"

# 4. Re-sign the app (REQUIRED for all builds!)
codesign --force --deep --sign - "$BUNDLE"
```

**Why re-signing is needed**: After copying libraries, the app bundle contents changed. Re-signing ensures all components use the same signature, avoiding Team ID conflicts.

### FAQ

**Q: Do I need signing keys for local development?**  
A: **No!** Signing keys are only needed for:

- **Auto-update feature** (signing update packages)
- **Release builds** distributed to users

For local development:

- Just run `bun tauri dev` (no signing needed)
- For local builds, skip the signing env vars and manually re-sign after copying libraries

**Q: Can I skip the re-signing step?**  
A: No. The app will crash when loading models due to signature mismatch.

**Q: What if I have Apple Developer ID?**  
A: You can use official signing and skip the re-signing step. Users can install directly without "right-click open".

**Q: Why not use static linking?**  
A: Currently not feasible. Sherpa-ONNX static build uses ONNX Runtime 1.17.1 (too old), incompatible with `ort` crate (requires API v22). Waiting for upstream updates.

---

## 📦 Build Output

After building, you'll find:

- **macOS**: `src-tauri/target/release/bundle/macos/Votype.app` and `.dmg`
- **Windows**: `src-tauri/target/release/bundle/msi/Votype_*.msi`
- **Linux**: `src-tauri/target/release/bundle/appimage/votype_*.AppImage`

---

## 🚢 Release Process

See [github_release_checklist.md](/.gemini/antigravity/brain/.../github_release_checklist.md) for GitHub Actions release setup.
