import { spawnDetached } from "../lib/process.js";

export type LaunchOptions = {
  emulatorPath: string;
  avd: string;
  coldBoot?: boolean;
  writableSystem?: boolean;
  environment?: NodeJS.ProcessEnv;
};

export function launchTvEmulator(options: LaunchOptions): number | undefined {
  const args = [
    `@${options.avd}`,
    "-no-boot-anim",
    "-gpu",
    "auto",
    "-no-snapshot-save",
  ];

  if (options.coldBoot) args.push("-no-snapshot-load");
  if (options.writableSystem) args.push("-writable-system");

  return spawnDetached(options.emulatorPath, args, {
    env: options.environment,
  });
}
