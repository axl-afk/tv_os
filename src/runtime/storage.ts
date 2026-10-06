import fs from "node:fs";
import path from "node:path";
import { runtimeAvdDir } from "./paths.js";

export const DEFAULT_USERDATA_SIZE = "4G";

export function applyRuntimeStoragePolicy(
  userdataSize = DEFAULT_USERDATA_SIZE,
): void {
  const configPath = path.join(runtimeAvdDir(), "config.ini");
  if (!fs.existsSync(configPath)) return;

  const current = fs.readFileSync(configPath, "utf8");
  const line = "disk.dataPartition.size=" + userdataSize;

  const next = /(^|\n)disk\.dataPartition\.size=.*(?=\n|$)/.test(current)
    ? current.replace(
        /(^|\n)disk\.dataPartition\.size=.*(?=\n|$)/,
        (_match, prefix) => prefix + line,
      )
    : current.replace(/\s*$/, "\n" + line + "\n");

  if (next !== current) {
    fs.writeFileSync(configPath, next);
  }
}

export function runtimeFreeSpaceBytes(): number | null {
  try {
    const stats = fs.statfsSync(runtimeAvdDir());
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}
