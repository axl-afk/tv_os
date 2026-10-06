import {
  detectAndroidTools,
  listAdbDevices,
  listAvds,
} from "../android/sdk.js";
import { launchTvEmulator } from "../android/emulator.js";
import {
  stopEmulator,
  waitForAndroidBoot,
  waitForNewAdbDevice,
} from "../android/readiness.js";
import { RuntimeInstaller } from "./installer.js";

const installer = new RuntimeInstaller();

installer.on("status", (status) => {
  const progress =
    typeof status.progress === "number" ? ` ${status.progress}%` : "";
  console.log(`[runtime-smoke] ${status.stage ?? status.state}${progress}: ${status.message}`);
});

await installer.install(true);

const tools = detectAndroidTools();
if (
  tools.source !== "ultimate-tv" ||
  !tools.adb ||
  !tools.emulator ||
  !tools.environment
) {
  throw new Error("Private Ultimate TV runtime was not detected after installation.");
}

const avds = listAvds(tools.emulator, tools.environment);
if (!avds.includes("Ultimate_TV_OS")) {
  throw new Error(
    "Runtime installer completed but Ultimate_TV_OS was not listed by the emulator. Found: " +
      avds.join(", "),
  );
}

console.log("[runtime-smoke] AVD discovered. Starting a headless cold boot…");
const before = new Set(listAdbDevices(tools.adb, tools.environment));

launchTvEmulator({
  emulatorPath: tools.emulator,
  avd: "Ultimate_TV_OS",
  coldBoot: true,
  headless: true,
  noAudio: true,
  gpuMode: "swiftshader_indirect",
  environment: tools.environment,
});

const serial = await waitForNewAdbDevice(tools.adb, before, 180_000);
console.log("[runtime-smoke] Guest connected as " + serial + ". Waiting for Android boot…");

try {
  await waitForAndroidBoot(tools.adb, serial, 300_000);
  console.log("[runtime-smoke] SUCCESS: Google TV reached sys.boot_completed=1.");
} finally {
  try {
    stopEmulator(tools.adb, serial);
  } catch (error) {
    console.warn("[runtime-smoke] Emulator shutdown warning:", error);
  }
}
