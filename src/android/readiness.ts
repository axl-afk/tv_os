import { run } from "../lib/process.js";
import { listAdbDevices } from "./sdk.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForNewAdbDevice(
  adbPath: string,
  before: Set<string>,
  timeoutMs = 120_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = listAdbDevices(adbPath);
    const added = current.find((serial) => !before.has(serial));
    if (added) return added;

    const emulator = current.find((serial) => serial.startsWith("emulator-"));
    if (emulator && before.size === 0) return emulator;

    await sleep(1000);
  }

  throw new Error("Timed out waiting for the Android TV emulator to appear in ADB.");
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
