# Ultimate TV OS roadmap

## M0 — protocol proof

Status: **COMPLETE — hardware verified on Apple Silicon macOS with the Google TV phone remote**

- Android SDK detection.
- TV AVD enumeration.
- TV AVD launch.
- Persistent host TLS identity.
- `_androidtvremote2._tcp` mDNS advertisement.
- Pairing service on TCP 6467.
- Remote service on TCP 6466.
- Pairing PIN generation.
- Remote DPAD/Home/Back/media events forwarded through ADB.
- Unit tests for protobuf framing.
- CI.

Exit criterion: a supported phone can discover the host, pair, and navigate a running TV guest. **Verified successfully with the Google TV app controlling the virtual TV through the native Android TV Remote Service proxy.**

## M1 — standalone desktop product

Status: **IN PROGRESS — Android Studio dependency removed from the normal user flow**

Completed:

- cross-platform desktop launcher on macOS, Windows, and Linux;
- first-run TV runtime installer;
- Google repository/package discovery;
- checksum verification when Google publishes a checksum;
- hardened ZIP extraction;
- private ADB/platform-tools installation;
- private Android virtualization engine installation;
- private Google TV system-image installation;
- automatic `Ultimate_TV_OS` virtual-device creation;
- one-click Start TV / Stop TV;
- Android boot/readiness detection;
- runtime reset/repair path;
- native Google Remote Service proxy;
- packaged DMG/ZIP, EXE, AppImage, and DEB builds;
- live Google package-manifest monitoring.

Recently completed:

- the desktop path now launches Google TV headlessly instead of exposing an emulator window;
- Ultimate TV owns a frameless fullscreen TV surface;
- monitor selection is built into the launcher;
- the guest display is streamed over the emulator's local gRPC display API;
- keyboard and pointer input are forwarded to the guest.

Remaining before M1 is truly consumer-ready:

- validate the embedded display path on real macOS/Windows/Linux hardware and optimize beyond the initial PNG/1080p renderer;
- remote tap/OK fix;
- suspend/resume and crash recovery;
- polished audio/display routing;
- production code signing/notarization;
- automatic application/runtime updates.

Exit criterion: a non-developer can install Ultimate TV, install its runtime from inside the app, and use the TV without Terminal or Android Studio.

## M2 — virtual hardware contract

Define **Ultimate Virtual TV Gen 1** with ARM64/x86-64 CPU profiles, virtual display/audio/network/input, controller support, secure storage, a virtual TEE interface, and a hardware capability manifest.

Move guest interaction away from developer-only ADB toward production virtual devices.

## M3 — Android-derived TV image

- AOSP TV build pipeline.
- reproducible ARM64 image.
- reproducible x86-64 image.
- OTA/A-B updates.
- secure/verified boot.
- crash/recovery mode.
- CDD compliance work.
- CTS/VTS automation.

No unlicensed Google applications are bundled.

## M4 — Windows + Linux

- WHPX/Hyper-V backend.
- KVM backend.
- GPU acceleration.
- consistent virtual hardware ABI.
- installers/updaters.
- host diagnostics.

## M5 — commercial security

- host-bound virtual device identity.
- TPM/Secure Enclave integration research.
- measured boot.
- encrypted key store.
- protected media pipeline.
- threat model and external security assessment.

## M6 — Google commercial path

External partnership milestone:

- Android compatibility evidence.
- Google partner/OEM engagement.
- GMS licensing path.
- Play Protect/device certification path.
- Google TV experience eligibility.
- Cast/Gemini/other licensed components as permitted.

## M7 — DRM/service certification

External approval milestones:

- Widevine integration/provisioning.
- Netflix device certification.
- Prime Video approval.
- Disney+/other provider qualification.
- Dolby/HDR licensing/certification where applicable.

## M8 — production release

- macOS ARM64.
- Windows x86-64.
- Linux x86-64.
- optional Windows ARM64/Linux ARM64.
- automatic secure updates.
- privacy-controlled telemetry.
- release channels.
- recovery tooling.

## Non-goals

The product will not depend on leaked Google TV images, device fingerprint spoofing, Play Protect bypasses, extracted Widevine production keys, or bypassing streaming-provider certification.
