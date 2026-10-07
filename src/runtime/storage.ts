import fs from "node:fs";
import path from "node:path";
import { runtimeAvdDir } from "./paths.js";

export const DEFAULT_USERDATA_SIZE = "4G";

function updateConfigValue(
  content: string,
  key: string,
  value: string,
): string {
  const escaped = key.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    "(^|\\n)" + escaped + "=.*(?=\\n|$)",
  );
  const line = key + "=" + value;

  return pattern.test(content)
    ? content.replace(
        pattern,
        (_match, prefix) => prefix + line,
      )
    : content.replace(/\s*$/, "\n" + line + "\n");
}

export function applyRuntimeStoragePolicy(
  userdataSize = DEFAULT_USERDATA_SIZE,
): void {
  const configPath = path.join(runtimeAvdDir(), "config.ini");
  if (!fs.existsSync(configPath)) return;

  const current = fs.readFileSync(configPath, "utf8");
  const next = updateConfigValue(
    current,
    "disk.dataPartition.size",
    userdataSize,
  );

  if (next !== current) {
    fs.writeFileSync(configPath, next);
  }
}

export type RuntimeDisplayProfile =
  | "720p60"
  | "1080p60"
  | "4k60"
  | "native";

function displayProfile(profile: RuntimeDisplayProfile) {
  if (profile === "720p60") {
    return { width: "1280", height: "720", density: "320", vsync: "60" };
  }
  if (profile === "1080p60") {
    return { width: "1920", height: "1080", density: "320", vsync: "60" };
  }

  // Direct/native and 4K embedded both use the real 4K TV framebuffer.
  return { width: "3840", height: "2160", density: "640", vsync: "60" };
}

export function applyRuntimeGoogleTvProfile(
  profileName: RuntimeDisplayProfile = "4k60",
): void {
  const configPath = path.join(runtimeAvdDir(), "config.ini");
  if (!fs.existsSync(configPath)) return;

  const display = displayProfile(profileName);

  const profile: Record<string, string> = {
    "PlayStore.enabled": "true",
    "hw.device.manufacturer": "Google",
    "hw.device.name": "tv_4k",
    "hw.initialOrientation": "landscape",
    "hw.audioInput": "no",
    "hw.audioOutput": "yes",
    "hw.keyboard": "yes",
    "hw.keyboard.lid": "yes",
    "hw.dPad": "yes",
    "hw.mainKeys": "yes",
    "hw.lcd.width": display.width,
    "hw.lcd.height": display.height,
    "hw.lcd.density": display.density,
    "hw.lcd.vsync": display.vsync,
    "hw.sensors.orientation": "no",
    "hw.sensors.proximity": "no",
    "showDeviceFrame": "no",
    "skin.dynamic": "yes",
    "tag.display": "Google TV",
    "tag.id": "google-tv",
  };

  const current = fs.readFileSync(configPath, "utf8");
  let next = current;
  for (const [key, value] of Object.entries(profile)) {
    next = updateConfigValue(next, key, value);
  }

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
