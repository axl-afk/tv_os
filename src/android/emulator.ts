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

export function buildEmulatorArgs(
  options: Omit<LaunchOptions, "emulatorPath" | "environment">,
): string[] {
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
    // Android Studio uses token-authenticated emulator gRPC. In this mode the
    // emulator advertises grpc.port/grpc.token through its discovery file and
    // restricts the unauthenticated control surface to the local host.
    args.push("-grpc", String(options.grpcPort), "-grpc-use-token");
  }

  return args;
}

export function launchTvEmulator(options: LaunchOptions): number | undefined {
  const args = buildEmulatorArgs(options);

  return spawnDetached(options.emulatorPath, args, {
    env: options.environment,
  });
}
