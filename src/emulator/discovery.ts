import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EmulatorGrpcEndpoint = {
  port: number;
  token: string;
  address: string;
  avdName?: string;
  file: string;
};

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function emulatorDiscoveryDirectories(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string[] {
  const uid = process.getuid?.();
  const androidRoots = [
    env.ANDROID_EMULATOR_HOME,
    env.ANDROID_PREFS_ROOT,
    env.ANDROID_SDK_HOME
      ? path.join(env.ANDROID_SDK_HOME, ".android")
      : undefined,
    path.join(home, ".android"),
  ];

  return unique([
    process.platform === "darwin"
      ? path.join(home, "Library", "Caches", "TemporaryItems", "avd", "running")
      : undefined,
    env.XDG_RUNTIME_DIR
      ? path.join(env.XDG_RUNTIME_DIR, "avd", "running")
      : undefined,
    uid !== undefined ? path.join("/run/user", String(uid), "avd", "running") : undefined,
    process.platform === "win32" && env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, "Temp", "avd", "running")
      : undefined,
    path.join(os.tmpdir(), "avd", "running"),
    ...androidRoots.map((root) =>
      root ? path.join(root, "avd", "running") : undefined,
    ),
  ]);
}

export function parseDiscoveryIni(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    fields.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }
  return fields;
}

function discoveryPid(name: string): number | null {
  const match = /^pid_(\d+)(?:_info)?\.ini$/.exec(name);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function consolePortFromSerial(serial: string): string | null {
  const match = /^emulator-(\d+)$/.exec(serial);
  return match?.[1] ?? null;
}

export function findEmulatorGrpcEndpoint(
  serial: string,
  directories = emulatorDiscoveryDirectories(),
): EmulatorGrpcEndpoint | null {
  const consolePort = consolePortFromSerial(serial);
  if (!consolePort) return null;

  const candidates: Array<EmulatorGrpcEndpoint & { modified: number }> = [];

  for (const directory of directories) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const pid = discoveryPid(entry.name);
      if (!pid || !processAlive(pid)) continue;

      const file = path.join(directory, entry.name);
      let fields: Map<string, string>;
      let modified = 0;
      try {
        fields = parseDiscoveryIni(fs.readFileSync(file, "utf8"));
        modified = fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }

      if (fields.get("port.serial") !== consolePort) continue;

      const port = Number(fields.get("grpc.port"));
      const token = fields.get("grpc.token")?.trim();
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) {
        continue;
      }

      const advertised = fields.get("grpc.address")?.trim();
      const address = advertised || `localhost:${port}`;

      candidates.push({
        port,
        token,
        address,
        avdName: fields.get("avd.name") || undefined,
        file,
        modified,
      });
    }
  }

  candidates.sort((a, b) => b.modified - a.modified);
  const found = candidates[0];
  if (!found) return null;

  return {
    port: found.port,
    token: found.token,
    address: found.address,
    avdName: found.avdName,
    file: found.file,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForEmulatorGrpcEndpoint(
  serial: string,
  timeoutMs = 20_000,
): Promise<EmulatorGrpcEndpoint> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const endpoint = findEmulatorGrpcEndpoint(serial);
    if (endpoint) return endpoint;
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for secure emulator gRPC discovery for ${serial}.`,
  );
}
