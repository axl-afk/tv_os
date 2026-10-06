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

export class AdbInput {
  constructor(
    private readonly adbPath: string,
    private readonly serial?: string,
  ) {}

  key(remoteCode: number) {
    const androidCode = AndroidKeyCode[remoteCode] ?? remoteCode;
    const args = this.serial ? ["-s", this.serial] : [];
    args.push("shell", "input", "keyevent", String(androidCode));
    const result = run(this.adbPath, args);
    if (!result.ok) {
      throw new Error(result.stderr.trim() || `ADB key injection failed for ${androidCode}`);
    }
  }

  text(value: string) {
    const escaped = value.replace(/ /g, "%s");
    const args = this.serial ? ["-s", this.serial] : [];
    args.push("shell", "input", "text", escaped);
    const result = run(this.adbPath, args);
    if (!result.ok) {
      throw new Error(result.stderr.trim() || "ADB text injection failed");
    }
  }
}
