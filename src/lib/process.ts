import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

export type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
};

export type ProcessOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export function run(
  command: string,
  args: string[] = [],
  options: ProcessOptions = {},
): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: options.env ? { ...process.env, ...options.env } : process.env,
    cwd: options.cwd,
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

export function spawnDetached(
  command: string,
  args: string[],
  options: ProcessOptions & { logFile?: string } = {},
) {
  let logFd: number | undefined;
  if (options.logFile) {
    fs.mkdirSync(require("node:path").dirname(options.logFile), { recursive: true });
    logFd = fs.openSync(options.logFile, "w");
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: logFd === undefined ? "ignore" : ["ignore", logFd, logFd],
    env: options.env ? { ...process.env, ...options.env } : process.env,
    cwd: options.cwd,
  });

  if (logFd !== undefined) fs.closeSync(logFd);
  child.unref();
  return child.pid;
}

export function terminateProcessTree(pid: number | undefined) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    // spawnDetached creates a new process group on POSIX.
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}
