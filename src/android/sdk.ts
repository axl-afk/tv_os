import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { run } from "../lib/process.js";

export type AndroidTools = {
  sdkRoot: string | null;
  adb: string | null;
  emulator: string | null;
  avdManager: string | null;
};

function firstExisting(candidates: string[]) {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function detectAndroidTools(): AndroidTools {
  const home = os.homedir();
  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.platform === "darwin" ? path.join(home, "Library/Android/sdk") : null,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Android/Sdk")
      : null,
    process.platform === "linux" ? path.join(home, "Android/Sdk") : null,
  ].filter((value): value is string => Boolean(value));

  const sdkRoot = roots.find((root) => fs.existsSync(root)) ?? null;
  if (!sdkRoot) {
    return { sdkRoot: null, adb: null, emulator: null, avdManager: null };
  }

  const exe = process.platform === "win32" ? ".exe" : "";
  const bat = process.platform === "win32" ? ".bat" : "";

  return {
    sdkRoot,
    adb: firstExisting([
      path.join(sdkRoot, "platform-tools", `adb${exe}`),
    ]),
    emulator: firstExisting([
      path.join(sdkRoot, "emulator", `emulator${exe}`),
    ]),
    avdManager: firstExisting([
      path.join(sdkRoot, "cmdline-tools", "latest", "bin", `avdmanager${bat}`),
    ]),
  };
}

export function listAvds(emulatorPath: string): string[] {
  const result = run(emulatorPath, ["-list-avds"]);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || "Unable to list Android virtual devices.");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listAdbDevices(adbPath: string): string[] {
  const result = run(adbPath, ["devices"]);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === "device")
    .map((parts) => parts[0]);
}
