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
import { EmulatorDisplayStream } from "../emulator/grpcDisplay.js";
import { reserveFreeLoopbackPort } from "../lib/network.js";
import { RuntimeInstaller } from "./installer.js";

const installer = new RuntimeInstaller();

installer.on("status", (status) => {
  const progress =
    typeof status.progress === "number" ? ` ${status.progress}%` : "";
  console.log(
    `[runtime-smoke] ${status.stage ?? status.state}${progress}: ${status.message}`,
  );
});

await installer.install(true);

const tools = detectAndroidTools();
if (
  tools.source !== "ultimate-tv" ||
  !tools.adb ||
  !tools.emulator ||
  !tools.environment
) {
  throw new Error(
    "Private Ultimate TV runtime was not detected after installation.",
  );
}

const avds = listAvds(tools.emulator, tools.environment);
if (!avds.includes("Ultimate_TV_OS")) {
  throw new Error(
    "Runtime installer completed but Ultimate_TV_OS was not listed by the emulator. Found: " +
      avds.join(", "),
  );
}

const grpcPort = await reserveFreeLoopbackPort();

console.log(
  `[runtime-smoke] AVD discovered. Starting a headless cold boot with gRPC on ${grpcPort}…`,
);
const before = new Set(listAdbDevices(tools.adb, tools.environment));

launchTvEmulator({
  emulatorPath: tools.emulator,
  avd: "Ultimate_TV_OS",
  coldBoot: true,
  headless: true,
  noAudio: true,
  grpcPort,
  gpuMode: "swiftshader_indirect",
  environment: tools.environment,
});

const serial = await waitForNewAdbDevice(
  tools.adb,
  before,
  180_000,
);
console.log(
  "[runtime-smoke] Guest connected as " +
    serial +
    ". Waiting for Android boot…",
);

let display: EmulatorDisplayStream | undefined;

try {
  await waitForAndroidBoot(tools.adb, serial, 300_000);
  console.log(
    "[runtime-smoke] Google TV reached sys.boot_completed=1.",
  );

  display = new EmulatorDisplayStream({
    port: grpcPort,
    appPath: process.cwd(),
    width: 1280,
    height: 720,
    maxFps: 5,
  });

  const firstFrame = new Promise<{
    width: number;
    height: number;
    bytes: number;
  }>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Timed out waiting for the first embedded TV frame.",
          ),
        ),
      30_000,
    );

    display!.once("frame", (frame) => {
      clearTimeout(timer);
      resolve({
        width: frame.width,
        height: frame.height,
        bytes: frame.png.length,
      });
    });

    display!.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await display.start();
  const frame = await firstFrame;

  if (frame.bytes < 100) {
    throw new Error("Embedded TV gRPC frame was unexpectedly empty.");
  }

  console.log(
    `[runtime-smoke] SUCCESS: embedded TV frame ${frame.width}x${frame.height}, ${frame.bytes} bytes.`,
  );
} finally {
  display?.stop();

  try {
    stopEmulator(tools.adb, serial);
  } catch (error) {
    console.warn(
      "[runtime-smoke] Emulator shutdown warning:",
      error,
    );
  }
}
