import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { run } from "../lib/process.js";
import {
  privateRuntimeReady,
  runtimeAvdHome,
  runtimeEnvironment,
  runtimeSdkRoot,
} from "../runtime/paths.js";

export type AndroidTools = {
  sdkRoot: string | null;
  adb: string | null;
  emulator: string | null;
  avdManager: string | null;
  source: "ultimate-tv" | "system" | null;
  environment?: NodeJS.ProcessEnv;
  avdHome?: string;
};

function firstExisting(candidates: string[]) {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function toolsForRoot(
  sdkRoot: string,
  source: "ultimate-tv" | "system",
  environment?: NodeJS.ProcessEnv,
  avdHome?: string,
): AndroidTools {
  const exe = process.platform === "win32" ? ".exe" : "";
  const bat = process.platform === "win32" ? ".bat" : "";

  return {
    sdkRoot,
    adb: firstExisting([path.join(sdkRoot, "platform-tools", `adb${exe}`)]),
    emulator: firstExisting([path.join(sdkRoot, "emulator", `emulator${exe}`)]),
    avdManager: firstExisting([
      path.join(sdkRoot, "cmdline-tools", "latest", "bin", `avdmanager${bat}`),
    ]),
    source,
    environment,
    avdHome,
  };
}

export function detectAndroidTools(): AndroidTools {
  if (privateRuntimeReady()) {
    return toolsForRoot(
      runtimeSdkRoot(),
      "ultimate-tv",
      runtimeEnvironment(),
      runtimeAvdHome(),
    );
  }

  const home = os.homedir();
  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.platform === "darwin" ? path.join(home, "Library", "Android", "sdk") : null,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk")
      : null,
    process.platform === "win32" && process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, "AppData", "Local", "Android", "Sdk")
      : null,
    process.platform === "linux" ? path.join(home, "Android", "Sdk") : null,
    process.platform === "linux" ? path.join(home, "Android", "sdk") : null,
    process.platform === "linux" ? "/opt/android-sdk" : null,
    process.platform === "linux" ? "/usr/lib/android-sdk" : null,
  ].filter((value): value is string => Boolean(value));

  const sdkRoot = roots.find((root) => fs.existsSync(root)) ?? null;
  if (!sdkRoot) {
    return {
      sdkRoot: null,
      adb: null,
      emulator: null,
      avdManager: null,
      source: null,
    };
  }

  return toolsForRoot(sdkRoot, "system");
}

export function listAvds(
  emulatorPath: string,
  environment?: NodeJS.ProcessEnv,
): string[] {
  const result = run(emulatorPath, ["-list-avds"], { env: environment });
  if (!result.ok) {
    throw new Error(result.stderr.trim() || "Unable to list Android virtual devices.");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listAdbDevices(
  adbPath: string,
  environment?: NodeJS.ProcessEnv,
): string[] {
  const result = run(adbPath, ["devices"], { env: environment });
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === "device")
    .map((parts) => parts[0]);
}
