import { spawnSync } from "node:child_process";

export type RuntimeHostArch = "arm64" | "x64";

export function resolveRuntimeHostArch(
  platform: NodeJS.Platform,
  processArch: string,
  macArm64Capable = false,
): RuntimeHostArch {
  if (platform === "darwin" && macArm64Capable) return "arm64";
  return processArch === "arm64" ? "arm64" : "x64";
}

function macHasArm64Hardware(): boolean {
  if (process.platform !== "darwin") return false;

  const result = spawnSync(
    "/usr/sbin/sysctl",
    ["-n", "hw.optional.arm64"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  return result.status === 0 && result.stdout.trim() === "1";
}

export function runtimeHostArch(): RuntimeHostArch {
  return resolveRuntimeHostArch(
    process.platform,
    process.arch,
    macHasArm64Hardware(),
  );
}

export function runtimeTvAbi(): "arm64-v8a" | "x86_64" {
  return runtimeHostArch() === "arm64" ? "arm64-v8a" : "x86_64";
}

export function runtimeRepositoryHostArch(): "aarch64" | "x86_64" {
  return runtimeHostArch() === "arm64" ? "aarch64" : "x86_64";
}
