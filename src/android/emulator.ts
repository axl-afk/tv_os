import { spawnDetached } from "../lib/process.js";

export type LaunchOptions = {
  emulatorPath: string;
  avd: string;
  fullScreen?: boolean;
  coldBoot?: boolean;
  writableSystem?: boolean;
};

export function launchTvEmulator(options: LaunchOptions): number | undefined {
  const args = [`@${options.avd}`, "-no-boot-anim"];

  if (options.coldBoot) args.push("-no-snapshot-load");
  if (options.writableSystem) args.push("-writable-system");

  // The emulator itself owns the window. The host bridge remains independent,
  // which lets us later replace the emulator with a native hypervisor backend.
  if (options.fullScreen && process.platform === "darwin") {
    args.push("-qt-hide-window", "0");
  }

  return spawnDetached(options.emulatorPath, args);
}
