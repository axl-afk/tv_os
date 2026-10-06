#!/usr/bin/env bash
set -euo pipefail

echo "Ultimate TV OS — Linux bootstrap"
echo

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This bootstrap script is for Linux."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22+ is required; found $(node -v)."
  exit 1
fi

SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
ADB="$SDK_ROOT/platform-tools/adb"
EMU="$SDK_ROOT/emulator/emulator"

if [[ ! -x "$ADB" || ! -x "$EMU" ]]; then
  echo
  echo "Android SDK tooling was not found at:"
  echo "  $SDK_ROOT"
  echo
  echo "Install Android Studio and make sure these are installed:"
  echo "  - Android SDK Platform-Tools"
  echo "  - Android Emulator"
  echo "  - a Google TV / Android TV system image"
  exit 1
fi

if [[ ! -e /dev/kvm ]]; then
  echo
  echo "Warning: /dev/kvm is not available."
  echo "Android Emulator acceleration may be unavailable until KVM is enabled."
fi

npm install
npm run typecheck
npm test
npm run build

echo
echo "Bootstrap complete."
echo "Run: npm run desktop"
