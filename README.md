# Ultimate TV OS

Ultimate TV OS turns a desktop computer into a couch-first TV host. The desktop app now owns its **own private TV runtime**: it downloads the Android virtualization engine, platform-tools/ADB, and a compatible Google TV development image directly from Google's SDK repositories, then creates and manages the virtual TV automatically.

**Android Studio is no longer required for normal use.**

The same desktop application targets **macOS, Windows, and Linux**.

## Current status

- macOS Apple Silicon: TV boot + native Google phone-remote path hardware verified.
- Windows x86-64: desktop host + installer build supported; hardware validation pending.
- Linux x86-64: desktop host + AppImage/DEB build supported; hardware validation pending.
- First-run TV runtime installer: implemented.
- Private AVD creation: implemented.
- Google package-manifest monitoring: automated in GitHub Actions.
- Remote tap/OK behavior: still under active investigation; runtime/app completion is being handled independently.

## Install and run

Download the installer for your platform from the latest **Desktop builds** GitHub Actions artifact.

On first launch:

1. Open **Ultimate TV OS**.
2. Read and accept the Android SDK License.
3. Click **Install TV Runtime**.
4. Ultimate TV downloads the required components directly from Google.
5. The app creates **Ultimate TV** automatically.
6. Click **Start TV**.

There is no Android Studio, SDK Manager, or manual Device Manager setup in this path.

The private runtime is stored under:

```text
~/.ultimate-tv/runtime/
├── sdk/
│   ├── emulator/
│   ├── platform-tools/
│   └── system-images/
└── avd/
    └── Ultimate_TV_OS.avd/
```

## What the app installs

The first-run installer retrieves:

- current Android Platform Tools / ADB;
- a compatible stable Android Emulator engine for the host OS/CPU;
- the newest stable Google TV development system image matching the host architecture;
- a private 4K-oriented Ultimate TV virtual-device configuration.

Large archives are streamed to disk and verified against Google's published checksums when the repository supplies one. ZIP extraction rejects path traversal and unsafe symlink targets.

## Desktop application

The desktop launcher provides:

- one-click first-run TV runtime installation;
- runtime download/install progress;
- automatic Google package discovery;
- private AVD creation;
- runtime repair/reset;
- TV AVD discovery;
- one-click **Start TV**;
- Android boot/readiness detection;
- fullscreen request;
- cold boot option;
- native Google Remote Service mode;
- experimental compatibility remote mode;
- live session status;
- one-click **Stop TV**.

Run from source:

```bash
npm install
npm run desktop
```

Node.js 22+ is only required when running from source; packaged desktop builds include Electron/Node.

## Platform notes

### macOS

Supported development targets:

- Apple Silicon (arm64)
- Intel (x64)

The runtime installer selects the matching Google emulator engine and Google TV ABI automatically.

macOS may request Accessibility permission when Ultimate TV attempts to move the external TV runtime window into macOS fullscreen.

### Windows

Current packaged target:

- Windows 10/11 x86-64

Hardware virtualization should be enabled in firmware/Windows. If Windows Defender Firewall asks whether Ultimate TV OS may accept incoming connections, allow it on **Private networks** for phone-remote discovery.

### Linux

Current packaged target:

- Linux x86-64

KVM is strongly recommended for acceptable virtual-TV performance. A restrictive firewall should permit trusted-LAN mDNS and Android TV Remote traffic when phone-remote support is used.

## Phone remote

Remote work is separate from the standalone runtime installer. The verified native path is:

```text
Google TV app on phone
        |
        | local network
        v
Ultimate TV OS host
        |
        | transparent TCP proxy
        v
Google Android TV Remote Service
inside the TV guest
```

Pairing/discovery works on the macOS reference setup. Tap/OK handling still needs additional work and is intentionally not blocking completion of the standalone app/runtime.

## CLI

The CLI remains available for development/debugging:

```bash
npm run build
npm run runtime:probe
npm run tv -- doctor
npm run tv -- avds
npm run tv -- session --avd Ultimate_TV_OS --remote-mode native
npm run tv -- stop --serial emulator-5554
```

## Build installers

```bash
# macOS
npm run dist:mac

# Windows
npm run dist:win

# Linux
npm run dist:linux
```

GitHub Actions packages all three platforms on native runners.

## Important licensing boundary

Ultimate TV OS does **not** put Google's proprietary runtime binaries or Google TV image inside this Git repository or installer.

The user explicitly accepts Google's Android SDK License, and the first-run installer downloads the selected SDK/runtime components directly from Google's distribution servers.

This does not grant commercial Google TV/GMS, Widevine, Netflix, Prime Video, Disney+, Dolby, or similar certification. Those remain separate vendor approval/licensing workstreams.

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Certification boundary](docs/CERTIFICATION.md)
- [Cross-platform notes](docs/CROSS_PLATFORM.md)
- [macOS hardware test](docs/MACOS_TEST.md)

## Runtime backend vs final virtualization layer

The current standalone app still uses Google's Android Emulator **engine internally**. The important change is that the user no longer installs or manages Android Studio: Ultimate TV owns the runtime, system image, AVD, launch lifecycle, and updates.

ADB alone cannot replace a virtualization engine; it only communicates with a running Android guest.

A later architecture milestone can replace Google's emulator engine with native host backends:

```text
macOS   → Apple Hypervisor / Virtualization framework
Windows → WHPX / Hyper-V
Linux   → KVM
```

That replacement is independent of the first-run standalone app work now implemented.
