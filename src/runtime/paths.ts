import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runtimeTvAbi } from "./host.js";

export const RUNTIME_AVD_NAME = "Ultimate_TV_OS";

export function runtimeRoot(): string {
  return process.env.ULTIMATE_TV_RUNTIME_ROOT ?? path.join(os.homedir(), ".ultimate-tv", "runtime");
}

export function runtimeSdkRoot(): string { return path.join(runtimeRoot(), "sdk"); }
export function runtimeAvdHome(): string { return path.join(runtimeRoot(), "avd"); }
export function runtimeDownloads(): string { return path.join(runtimeRoot(), "downloads"); }
export function runtimeMetadataPath(): string { return path.join(runtimeRoot(), "runtime.json"); }
export function runtimeAvdDir(): string { return path.join(runtimeAvdHome(), `${RUNTIME_AVD_NAME}.avd`); }
export function runtimeAvdIni(): string { return path.join(runtimeAvdHome(), `${RUNTIME_AVD_NAME}.ini`); }

export function runtimeEnvironment(): NodeJS.ProcessEnv {
  const sdkRoot = runtimeSdkRoot();
  return {
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_AVD_HOME: runtimeAvdHome(),
  };
}

export function runtimeExecutable(name: "adb" | "emulator"): string {
  const exe = process.platform === "win32" ? ".exe" : "";
  if (name === "adb") return path.join(runtimeSdkRoot(), "platform-tools", `adb${exe}`);
  return path.join(runtimeSdkRoot(), "emulator", `emulator${exe}`);
}

export function privateRuntimeReady(): boolean {
  const filesReady =
    fs.existsSync(runtimeExecutable("adb")) &&
    fs.existsSync(runtimeExecutable("emulator")) &&
    fs.existsSync(runtimeAvdIni()) &&
    fs.existsSync(runtimeAvdDir());

  if (!filesReady) return false;

  try {
    const metadata = JSON.parse(
      fs.readFileSync(runtimeMetadataPath(), "utf8"),
    ) as { abi?: string };

    return metadata.abi === runtimeTvAbi();
  } catch {
    return false;
  }
}
