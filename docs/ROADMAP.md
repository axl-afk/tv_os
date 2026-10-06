# Ultimate TV OS roadmap

## M0 — protocol proof

Status: **implemented in repository**

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

Exit criterion: a supported phone can discover the host, pair, and navigate a running TV guest.

## M1 — macOS reference product

- Native macOS launcher UI.
- one-click guest creation.
- one-click Start TV / Exit TV.
- display selection.
- proper fullscreen.
- guest readiness detection.
- remote service starts automatically.
- suspend/resume.
- audio routing.
- controller input.
- robust text input.
- voice forwarding investigation.
- automatic recovery if ADB/emulator restarts.
- signed/notarized macOS application.

Exit criterion: a non-developer can install and use Ultimate TV without Terminal.

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
