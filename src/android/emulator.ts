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
    // Android Emulator's current CLI parser declares -grpc as <port>.
    // A high random port is allocated per Ultimate TV session.
    args.push("-grpc", String(options.grpcPort));
  }

  return spawnDetached(options.emulatorPath, args, {
    env: options.environment,
  });
}
