#!/usr/bin/env bash
set -euo pipefail

echo "Ultimate TV OS — macOS bootstrap"
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bootstrap script is for macOS."
  exit 1
fi

ARCH="$(uname -m)"
echo "Host architecture: $ARCH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required."
  echo "Install it with Homebrew: brew install node@22"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22+ is required; found $(node -v)."
  exit 1
fi

SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ADB="$SDK_ROOT/platform-tools/adb"
EMU="$SDK_ROOT/emulator/emulator"

if [[ ! -x "$ADB" || ! -x "$EMU" ]]; then
  echo
  echo "Android SDK tooling was not found at:"
  echo "  $SDK_ROOT"
  echo
  echo "Install Android Studio, then in SDK Manager install:"
  echo "  - Android SDK Platform-Tools"
  echo "  - Android Emulator"
  echo "  - a Google TV or Android TV system image"
  exit 1
fi

echo "Android SDK: $SDK_ROOT"
echo
echo "Installed AVDs:"
"$EMU" -list-avds || true
echo

npm install
npm run typecheck
npm test
npm run build

echo
echo "Bootstrap complete."
echo "Run: npm run tv -- doctor"
