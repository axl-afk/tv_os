import { spawnDetached } from "../lib/process.js";

export type LaunchOptions = {
  emulatorPath: string;
  avd: string;
  coldBoot?: boolean;
  writableSystem?: boolean;
  headless?: boolean;
  noAudio?: boolean;
  grpcPort?: number;
  gpuMode?: string;
  environment?: NodeJS.ProcessEnv;
};

export function launchTvEmulator(options: LaunchOptions): number | undefined {
  const args = [
    `@${options.avd}`,
    "-no-boot-anim",
    "-gpu",
    options.gpuMode ?? "auto",
    "-no-snapshot-save",
  ];

  if (options.coldBoot) args.push("-no-snapshot-load");
  if (options.writableSystem) args.push("-writable-system");
  if (options.headless) args.push("-no-window");
  if (options.noAudio) args.push("-no-audio");
  if (options.grpcPort) {
    // Bind the emulator-control endpoint to host loopback only.
    // The embedded TV renderer is local to Ultimate TV OS and this
    // control surface must never be reachable from the LAN.
    args.push("-grpc", `localhost:${options.grpcPort}`);
  }

  return spawnDetached(options.emulatorPath, args, {
    env: options.environment,
  });
}
