import { spawn, spawnSync } from "node:child_process";

export type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
};

export function run(command: string, args: string[] = []): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

export function spawnDetached(command: string, args: string[]) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}
