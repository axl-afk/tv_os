import { spawnSync } from "node:child_process";

export type RuntimeHostArch = "arm64" | "x64";

export function resolveRuntimeHostArch(
  platform: NodeJS.Platform,
  processArch: string,
  macArm64Capable = false,
  windowsArm64Capable = false,
): RuntimeHostArch {
  if (platform === "darwin" && macArm64Capable) return "arm64";
  if (platform === "win32" && windowsArm64Capable) return "arm64";
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

  if (sysctlNumber("sysctl.proc_translated") === 1) return true;
  return sysctlNumber("hw.optional.arm64") === 1;
}

function windowsHasArm64Hardware(): boolean {
  if (process.platform !== "win32") return false;
  if (process.arch === "arm64") return true;

  const native =
    process.env.PROCESSOR_ARCHITEW6432 ??
    process.env.PROCESSOR_ARCHITECTURE ??
    "";

  return native.toUpperCase().includes("ARM64");
}

export function runtimeHostArch(): RuntimeHostArch {
  return resolveRuntimeHostArch(
    process.platform,
    process.arch,
    macHasArm64Hardware(),
    windowsHasArm64Hardware(),
  );
}

export function runtimeTvAbi(): "arm64-v8a" | "x86_64" {
  return runtimeHostArch() === "arm64" ? "arm64-v8a" : "x86_64";
}

export function runtimeRepositoryHostArch(): "aarch64" | "x86_64" {
  return runtimeHostArch() === "arm64" ? "aarch64" : "x86_64";
}
