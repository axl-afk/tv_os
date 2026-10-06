import os from "node:os";
import { detectAndroidTools, listAdbDevices, listAvds } from "./android/sdk.js";

export function runDoctor() {
  const tools = detectAndroidTools();
  const rows: Array<[string, string]> = [
    ["OS", `${process.platform} ${os.release()}`],
    ["Architecture", process.arch],
    ["Node", process.version],
    ["Android SDK", tools.sdkRoot ?? "NOT FOUND"],
    ["adb", tools.adb ?? "NOT FOUND"],
    ["emulator", tools.emulator ?? "NOT FOUND"],
  ];

  for (const [name, value] of rows) {
    console.log(`${name.padEnd(16)} ${value}`);
  }

  if (tools.emulator) {
    try {
      const avds = listAvds(tools.emulator);
      console.log(`AVDs             ${avds.length ? avds.join(", ") : "none"}`);
    } catch (error) {
      console.log(`AVDs             error: ${String(error)}`);
    }
  }

  if (tools.adb) {
    console.log(`ADB devices      ${listAdbDevices(tools.adb).join(", ") || "none"}`);
  }

  const ok = Boolean(tools.adb && tools.emulator);
  console.log("");
  console.log(ok ? "Host tooling looks ready." : "Install/fix Android Studio SDK tooling before launch.");
  return ok;
}
