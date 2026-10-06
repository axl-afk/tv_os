import os from "node:os";
import { detectAndroidTools, listAdbDevices, listAvds } from "./android/sdk.js";

export function runDoctorSnapshot() {
  const tools = detectAndroidTools();
  let avds: string[] = [];
  let adbDevices: string[] = [];

  if (tools.emulator) {
    try { avds = listAvds(tools.emulator); } catch { avds = []; }
  }
  if (tools.adb) {
    try { adbDevices = listAdbDevices(tools.adb); } catch { adbDevices = []; }
  }

  return {
    os: `${process.platform} ${os.release()}`,
    architecture: process.arch,
    node: process.version,
    sdkRoot: tools.sdkRoot,
    adb: tools.adb,
    emulator: tools.emulator,
    avds,
    adbDevices,
    ready: Boolean(tools.adb && tools.emulator),
  };
}

export function runDoctor() {
  const snapshot = runDoctorSnapshot();
  const rows: Array<[string, string]> = [
    ["OS", snapshot.os],
    ["Architecture", snapshot.architecture],
    ["Node", snapshot.node],
    ["Android SDK", snapshot.sdkRoot ?? "NOT FOUND"],
    ["adb", snapshot.adb ?? "NOT FOUND"],
    ["emulator", snapshot.emulator ?? "NOT FOUND"],
  ];

  for (const [name, value] of rows) {
    console.log(`${name.padEnd(16)} ${value}`);
  }

  console.log(`AVDs             ${snapshot.avds.length ? snapshot.avds.join(", ") : "none"}`);
  console.log(`ADB devices      ${snapshot.adbDevices.join(", ") || "none"}`);

  console.log("");
  console.log(snapshot.ready ? "Host tooling looks ready." : "Install/fix Android Studio SDK tooling before launch.");
  return snapshot.ready;
}
