# Ultimate TV OS

Ultimate TV OS turns a desktop computer into a couch-first TV host. It launches an Android TV / Google TV virtual device and exposes the guest's native Google Android TV Remote Service to the local network so the normal Google TV phone app can control it.

The same host application now targets **macOS, Windows, and Linux**.

## Current status

- macOS Apple Silicon: remote-control path hardware verified.
- Windows x86-64: desktop host + installer build supported; hardware validation pending.
- Linux x86-64: desktop host + AppImage/DEB build supported; hardware validation pending.
- Native Google Android TV Remote Service proxy is preferred automatically.
- Compatibility remote server remains as a fallback for non-Google TV images.

## Desktop application

The desktop launcher provides:

- Android SDK readiness checks.
- TV AVD discovery.
- TV-name configuration.
- cold-boot option.
- one-click **Start TV**.
- Android boot/readiness detection.
- automatic selection of Google's native TV remote service when present.
- live session state.
- one-click **Stop TV**.

Run it from source:

```bash
npm install
npm run desktop
```

## Platform setup

### macOS

Requirements:

- macOS with Android Studio.
- Node.js 22+ when running from source.
- Android Emulator + Platform Tools.
- an Android TV / Google TV AVD.

```bash
bash scripts/bootstrap-macos.sh
npm run desktop
```

On Apple Silicon, prefer an ARM64-compatible TV image.

### Windows

Requirements:

- Windows 10/11.
- Android Studio.
- Android Emulator + Platform Tools.
- hardware virtualization enabled.
- a Google TV / Android TV AVD.

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\bootstrap-windows.ps1
npm run desktop
```

If Windows Defender Firewall asks whether Ultimate TV OS may accept incoming connections, allow it on **Private networks** so your phone can reach the remote service.

### Linux

Requirements:

- a desktop Linux distribution.
- Android Studio / Android SDK.
- Android Emulator + Platform Tools.
- KVM acceleration recommended.
- a Google TV / Android TV AVD.

```bash
bash scripts/bootstrap-linux.sh
npm run desktop
```

If a host firewall is enabled, allow mDNS and the Android TV Remote v2 ports on the trusted LAN.

## Phone remote

When TV mode is running:

1. Put the computer and phone on the same LAN/Wi-Fi.
2. Open Google TV on the phone.
3. Open **Remote**.
4. Select **Ultimate TV OS** (or your configured TV name).
5. Complete Google's normal pairing flow.

The verified architecture is:

```text
Google TV app on phone
        |
        | local network
        | mDNS + TCP 6466/6467
        v
Ultimate TV OS host
        |
        | transparent TCP proxy
        v
ADB port forwarding
        |
        v
Google Android TV Remote Service
inside the TV guest
```

## CLI

The CLI remains available for debugging and automation:

```bash
npm run build

npm run tv -- doctor
npm run tv -- avds
npm run tv -- session --avd YOUR_TV_AVD
npm run tv -- remote
npm run tv -- stop --serial emulator-5554
```

## Build installers

Local packaging:

```bash
# macOS
npm run dist:mac

# Windows
npm run dist:win

# Linux
npm run dist:linux
```

GitHub Actions also has a **Desktop builds** workflow that packages artifacts on native macOS, Windows, and Linux runners.

## Important licensing boundary

This repository does **not** redistribute Google's proprietary Google TV launcher, Google Play Services, Play Store, Widevine production credentials, Netflix binaries, or certification material.

For development, use Android Studio's official TV system images available through the Android SDK tooling.

A commercial product with licensed Google TV/GMS, production Widevine, Netflix, Prime Video, Disney+, Dolby and similar protected integrations requires the respective vendor approval/certification.

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Certification boundary](docs/CERTIFICATION.md)
- [Cross-platform notes](docs/CROSS_PLATFORM.md)
- [macOS hardware test](docs/MACOS_TEST.md)
