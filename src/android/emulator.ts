import { run, spawnDetached } from "../lib/process.js";

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
  logFile?: string;
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

export function checkEmulatorAcceleration(
  emulatorPath: string,
  environment?: NodeJS.ProcessEnv,
): { ok: boolean; detail: string } {
  const result = run(emulatorPath, ["-accel-check"], { env: environment });
  const detail = [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

  return {
    ok: result.ok,
    detail: detail || "Android Emulator hardware acceleration check failed.",
  };
}

export function launchTvEmulator(options: LaunchOptions): number | undefined {
  const args = buildEmulatorArgs(options);

  return spawnDetached(options.emulatorPath, args, {
    env: options.environment,
    logFile: options.logFile,
  });
}
