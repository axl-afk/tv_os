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

function sysctlNumber(name: string): number | null {
  const result = spawnSync(
    "/usr/sbin/sysctl",
    ["-n", name],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  if (result.status !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

function macHasArm64Hardware(): boolean {
  if (process.platform !== "darwin") return false;
  if (process.arch === "arm64") return true;

  // Apple documents sysctl.proc_translated=1 for an Intel process currently
  // running through Rosetta on Apple Silicon.
  if (sysctlNumber("sysctl.proc_translated") === 1) return true;

  // Hardware-feature fallback for environments where proc_translated is not
  // exposed to the calling process.
  return sysctlNumber("hw.optional.arm64") === 1;
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
