import { processIsAlive, readLogTail, run } from "../lib/process.js";
import { listAdbDevices } from "./sdk.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForNewAdbDevice(
  adbPath: string,
  before: Set<string>,
  timeoutMs = 120_000,
  environment?: NodeJS.ProcessEnv,
  emulatorPid?: number,
  emulatorLogFile?: string,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = listAdbDevices(adbPath, environment);
    const added = current.find((serial) => !before.has(serial));
    if (added) return added;

    const emulator = current.find((serial) => serial.startsWith("emulator-"));
    if (emulator && before.size === 0) return emulator;

    if (emulatorPid && !processIsAlive(emulatorPid)) {
      const detail = readLogTail(emulatorLogFile);
      throw new Error(
        "Android TV engine exited before ADB connected." +
          (detail ? "\n\nEmulator output:\n" + detail : ""),
      );
    }

    await sleep(1000);
  }

  const detail = readLogTail(emulatorLogFile);
  throw new Error(
    "Timed out waiting for the Android TV emulator to appear in ADB." +
      (detail ? "\n\nEmulator output:\n" + detail : ""),
  );
}

export async function waitForAndroidBoot(
  adbPath: string,
  serial: string,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = run(adbPath, [
      "-s",
      serial,
      "shell",
      "getprop",
      "sys.boot_completed",
    ]);

    if (result.ok && result.stdout.trim() === "1") return;
    await sleep(1500);
  }

  throw new Error(`Timed out waiting for Android to finish booting on ${serial}.`);
}

export function stopEmulator(adbPath: string, serial: string): void {
  const result = run(adbPath, ["-s", serial, "emu", "kill"]);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || `Unable to stop emulator ${serial}.`);
  }
}

export function findRunningAvdSerials(
  adbPath: string,
  avdName: string,
): string[] {
  const matches: string[] = [];

  for (const serial of listAdbDevices(adbPath)) {
    if (!serial.startsWith("emulator-")) continue;

    const result = run(adbPath, [
      "-s",
      serial,
      "emu",
      "avd",
      "name",
    ]);

    if (result.ok && result.stdout.trim().split(/\r?\n/)[0] === avdName) {
      matches.push(serial);
    }
  }

  return matches;
}

export async function stopRunningAvdInstances(
  adbPath: string,
  avdName: string,
  timeoutMs = 15_000,
): Promise<void> {
  const stale = findRunningAvdSerials(adbPath, avdName);
  if (!stale.length) return;

  for (const serial of stale) {
    try {
      stopEmulator(adbPath, serial);
    } catch {
      // Best-effort cleanup of stale private runtime instances.
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = new Set(listAdbDevices(adbPath));
    if (stale.every((serial) => !remaining.has(serial))) return;
    await sleep(250);
  }

  throw new Error(
    `A previous ${avdName} instance is still shutting down. Try Start TV again.`,
  );
}

export function getAndroidDisplaySize(
  adbPath: string,
  serial: string,
): { width: number; height: number } {
  const result = run(adbPath, [
    "-s",
    serial,
    "shell",
    "wm",
    "size",
  ]);

  if (!result.ok) return { width: 1920, height: 1080 };

  const matches = [...result.stdout.matchAll(/(\d+)x(\d+)/g)];
  const last = matches.at(-1);
  if (!last) return { width: 1920, height: 1080 };

  const width = Number(last[1]);
  const height = Number(last[2]);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1920, height: 1080 };
  }

  return { width, height };
}
