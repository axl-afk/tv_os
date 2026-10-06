# Cross-platform host notes

Ultimate TV OS uses one shared TypeScript core on macOS, Windows and Linux. The desktop shell is Electron; the TV guest is provided by the Android Emulator during the current product stage.

## Shared flow

```text
Desktop launcher
   |
   +-- detect Android SDK / AVDs
   +-- launch selected TV AVD
   +-- wait for ADB
   +-- wait for sys.boot_completed
   +-- detect native Google Android TV Remote Service
   +-- create ADB TCP forwards
   +-- publish Android TV Remote v2 service over mDNS
   +-- proxy phone connections into guest
```

## macOS

SDK discovery checks `ANDROID_SDK_ROOT`, `ANDROID_HOME`, then `~/Library/Android/sdk`.

The verified development target is Apple Silicon with an ARM64-compatible TV AVD.

Incoming connections to the desktop host must be permitted by the macOS firewall when enabled.

## Windows

SDK discovery checks `ANDROID_SDK_ROOT`, `ANDROID_HOME`, and the standard Local AppData Android SDK paths.

The Android Emulator requires hardware virtualization support for acceptable performance.

Windows Defender Firewall should allow Ultimate TV OS on Private networks. Public-network access is not required for normal phone-remote use.

## Linux

SDK discovery checks environment variables plus common `~/Android/Sdk`, `/opt/android-sdk`, and `/usr/lib/android-sdk` paths.

KVM is recommended for Android Emulator acceleration.

For hosts using a restrictive firewall, permit trusted-LAN traffic for:

- UDP 5353 (mDNS discovery)
- TCP 6466 (Android TV remote)
- TCP 6467 (pairing)

Do not expose these ports to the public Internet.

## Packaging

GitHub Actions builds each target on its native runner:

- macOS: DMG/ZIP, x64 and arm64
- Windows: NSIS x64 installer
- Linux: AppImage and DEB x64

Packages are currently unsigned development builds. Production releases should add Apple Developer ID signing/notarization, Windows code signing, and a release/update signing policy.
