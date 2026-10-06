import { spawn, spawnSync } from "node:child_process";

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
  options: ProcessOptions = {},
) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    cwd: options.cwd,
  });
  child.unref();
  return child.pid;
}
