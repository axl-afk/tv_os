# Ultimate TV OS architecture

## Product definition

Ultimate TV OS is a **software-defined television appliance** that runs on an existing desktop computer.

The user should eventually experience:

1. Install one desktop application.
2. Select a monitor.
3. Press **Start TV**.
4. The TV environment appears full-screen.
5. The normal Google TV phone app discovers the computer.
6. Pair once with an on-screen code.
7. Use the phone as the remote.

Virtualization/emulation is an implementation detail, not part of the user experience.

## Reference architecture

```text
Phone running Google TV remote
           |
           | mDNS + TLS
           | Android TV Remote v2
           v
+------------------------------------------+
| Ultimate TV Host                         |
|                                          |
| Remote Bridge :6466/:6467                |
|      |                                   |
|      | translates remote events          |
|      v                                   |
| ADB / future virtual input device        |
|      |                                   |
|      v                                   |
| Android TV / Google TV guest             |
|                                          |
| Android Emulator today                   |
| Native hypervisor backend later          |
+------------------------------------------+
           |
           v
        Monitor
```

## Why the remote endpoint is on the host

Desktop virtualization products commonly place guests behind NAT. mDNS discovery and inbound phone connections therefore become unreliable.

Ultimate TV instead exposes the Android TV Remote v2 endpoint on the **host LAN interface**. The host receives remote commands and injects them into the guest.

This gives the phone a normal same-LAN target without requiring the Android guest to have a separately bridged IP address.

## Milestone 1 backend

The first backend deliberately uses Google's Android Emulator because it gives us:

- Apple Silicon acceleration on macOS.
- official Android TV/Google TV development images where available;
- ADB;
- GPU/audio integration;
- snapshots;
- a repeatable developer platform.

The production architecture can later replace this backend without changing the remote protocol layer.

## Production backend targets

### macOS Apple Silicon

```text
Swift host application
      |
Virtualization / Hypervisor framework
      |
ARM64 Android-derived TV guest
      |
Metal-compatible rendering path
```

### Windows x86-64

```text
Windows host
   |
WHPX / Hyper-V
   |
x86-64 Android-derived TV guest
   |
Direct3D/Vulkan translation
```

### Linux x86-64

```text
Linux host
  |
KVM
  |
x86-64 Android-derived TV guest
  |
Vulkan/virtio-gpu
```

## Security boundary

Never place proprietary production DRM credentials in the open-source host application.

Future certification architecture should separate the host application, measured guest image, virtual secure storage, platform-bound identity, DRM component, protected video path, and update signing.
