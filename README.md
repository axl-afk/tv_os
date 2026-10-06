# Ultimate TV OS

Ultimate TV OS is an experimental software-defined TV platform for desktop computers.

The first reference target is **macOS on Apple Silicon**. The goal is to let a user launch a TV environment on a monitor, pair the normal Google TV phone remote, and control the TV UI from the couch.

## What this repository currently contains

- A TypeScript host service for macOS/Linux/Windows.
- Android Emulator/AVD discovery and launch orchestration.
- An Android TV Remote v2 compatible host-side pairing/control service.
- mDNS advertisement as `_androidtvremote2._tcp`.
- Translation of phone remote key events into Android `adb shell input keyevent` commands.
- A CLI for diagnostics, launching a TV AVD, and starting the remote bridge.
- Bootstrap scripts, tests, and GitHub Actions CI.
- Architecture and certification roadmap.

## Important product boundary

This repository does **not** redistribute Google's proprietary Google TV launcher, Google Play Services, Play Store, Widevine production keys, Netflix binaries, or certification credentials.

For development, use Android Studio's official Android TV / Google TV emulator images available through the Android SDK Manager. Google Play-labelled images include Play Store support where Google provides it for that image.

Commercial Google TV/GMS, Widevine, Netflix, Dolby, Prime Video, Disney+ and similar certification must be obtained from the respective rights holders.

## Quick start — macOS Apple Silicon

### Requirements

- macOS 14+
- Node.js 22+
- Android Studio
- Android SDK Platform Tools
- Android Emulator
- A Google TV or Android TV AVD created in Android Studio

Create the AVD in:

`Android Studio → Device Manager → + → Create Virtual Device → TV`

Prefer an **ARM64** TV image on Apple Silicon when one is available.

Then:

```bash
git clone https://github.com/axl-afk/tv_os.git
cd tv_os
npm install
npm run build

# Diagnose Android SDK, adb, emulator and AVDs
npm run tv -- doctor

# Show installed AVDs
npm run tv -- avds

# Recommended: launch the TV, wait for boot, and start the phone-remote bridge
npm run tv -- session --avd YOUR_TV_AVD

# Or run the two parts separately
npm run tv -- start --avd YOUR_TV_AVD
npm run tv -- remote
```

When pairing begins, the host prints a six-hex-digit pairing code. Enter that code in the Google TV app when it discovers **Ultimate TV OS**.

## Current milestone

**Milestone 1 — reference prototype**

1. Boot a TV AVD on Apple Silicon.
2. Run Ultimate TV Remote Bridge on the macOS host.
3. Advertise the host to the Google TV phone app.
4. Pair over TLS.
5. Forward DPAD/Home/Back/media events to the TV AVD through ADB.

This proves the product concept without pretending that third-party certification has already happened.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md), and [docs/CERTIFICATION.md](docs/CERTIFICATION.md).
