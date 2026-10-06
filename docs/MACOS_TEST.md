# macOS Apple Silicon test procedure

## 1. Create a TV AVD

Open Android Studio and go to:

`Device Manager → Create Virtual Device → TV`

Choose a Google TV or Android TV profile and an Apple-Silicon-compatible system image.

System-image availability changes with Android Studio/SDK releases, so use the current image offered by SDK Manager rather than hard-coding an old package name.

## 2. Build Ultimate TV

```bash
git clone https://github.com/axl-afk/tv_os.git
cd tv_os
./scripts/bootstrap-macos.sh
npm run tv -- doctor
npm run tv -- avds
```

## 3. Launch the TV guest

```bash
npm run tv -- start --avd YOUR_AVD_NAME
```

Wait for the TV home screen.

Verify ADB sees it:

```bash
~/Library/Android/sdk/platform-tools/adb devices
```

## 4. Start the phone remote bridge

```bash
npm run tv -- remote --name "Ultimate TV"
```

The host advertises itself as `_androidtvremote2._tcp`. Phone and Mac must be on the same LAN.

## 5. Pair

Open the Google TV app on the Android phone and open its remote. Select **Ultimate TV** if it is discovered.

The Terminal prints a pairing code similar to:

```text
====================================
 Ultimate TV pairing code: A1B2C3
====================================
```

Enter that code on the phone.

## 6. Input validation

Test Up/Down/Left/Right, Select, Home, Back, Play/Pause and Volume.

## Troubleshooting

If discovery fails, check same-LAN connectivity, VPN, AP/client isolation, macOS firewall permissions, TCP ports 6466/6467, and multicast/mDNS.

Delete `~/.ultimate-tv/` only when deliberately resetting the virtual TV identity.

If multiple emulators are connected, pass `--serial emulator-5554` (or the desired serial).
