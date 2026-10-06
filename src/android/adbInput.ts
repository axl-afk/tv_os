import { run } from "../lib/process.js";

export const AndroidKeyCode: Record<number, number> = {
  3: 3,    // HOME
  4: 4,    // BACK
  19: 19,  // DPAD_UP
  20: 20,  // DPAD_DOWN
  21: 21,  // DPAD_LEFT
  22: 22,  // DPAD_RIGHT
  23: 23,  // DPAD_CENTER
  24: 24,  // VOLUME_UP
  25: 25,  // VOLUME_DOWN
  26: 26,  // POWER
  66: 66,  // ENTER
  82: 82,  // MENU
  84: 84,  // SEARCH
  85: 85,  // MEDIA_PLAY_PAUSE
  87: 87,  // MEDIA_NEXT
  88: 88,  // MEDIA_PREVIOUS
  89: 89,  // MEDIA_REWIND
  90: 90,  // MEDIA_FAST_FORWARD
  164: 164 // VOLUME_MUTE
};

export interface RemoteInputTarget {
  key(remoteCode: number, direction?: number): void;
  text(value: string): void;
  openLink(value: string): void;
  showPairingPin?(pin: string): boolean;
  dismissPairingPin?(): void;
}

export class AdbInput implements RemoteInputTarget {
  constructor(
    private readonly adbPath: string,
    private readonly serial?: string,
  ) {}

  private baseArgs(): string[] {
    return this.serial ? ["-s", this.serial] : [];
  }

  key(remoteCode: number, direction = 3) {
    // RemoteDirection: START_LONG=1, END_LONG=2, SHORT=3.
    // `adb input keyevent --longpress` synthesizes both down/up, so END_LONG is ignored.
    if (direction === 2) return;

    const androidCode = AndroidKeyCode[remoteCode] ?? remoteCode;
    const args = this.baseArgs();
    args.push("shell", "input", "keyevent");
    if (direction === 1) args.push("--longpress");
    args.push(String(androidCode));

    const result = run(this.adbPath, args);
    if (!result.ok) {
      throw new Error(result.stderr.trim() || `ADB key injection failed for ${androidCode}`);
    }
  }

  text(value: string) {
    // ADB's legacy input helper is intentionally only the v0.1 fallback. The guest
    // companion IME is the production path for full Unicode/selection semantics.
    const escaped = value.replace(/%/g, "%25").replace(/ /g, "%s");
    const args = this.baseArgs();
    args.push("shell", "input", "text", escaped);
    const result = run(this.adbPath, args);
    if (!result.ok) {
      throw new Error(result.stderr.trim() || "ADB text injection failed");
    }
  }

  openLink(value: string) {
    const args = this.baseArgs();
    args.push(
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      value,
    );
    const result = run(this.adbPath, args);
    if (!result.ok) {
      throw new Error(result.stderr.trim() || "ADB app-link launch failed");
    }
  }

  showPairingPin(pin: string): boolean {
    const args = this.baseArgs();
    args.push(
      "shell",
      "am",
      "start",
      "-n",
      "com.ultimatetv.overlay/.PairingActivity",
      "--es",
      "code",
      pin,
    );
    const result = run(this.adbPath, args);
    const output = `${result.stdout}\n${result.stderr}`;
    return result.ok && !/Error|does not exist|unable to resolve/i.test(output);
  }

  dismissPairingPin() {
    const args = this.baseArgs();
    args.push("shell", "am", "force-stop", "com.ultimatetv.overlay");
    run(this.adbPath, args);
    this.key(3, 3);
  }
}
