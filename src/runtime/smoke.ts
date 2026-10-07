import net from "node:net";
import os from "node:os";
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
import { waitForEmulatorGrpcEndpoint } from "../emulator/discovery.js";
import { reserveFreeLoopbackPort } from "../lib/network.js";
import { run } from "../lib/process.js";
import { provisionAndroidTvGuest } from "../android/provision.js";
import { RuntimeInstaller } from "./installer.js";
import { prepareNativeAndroidTvRemoteService } from "../remote/nativeProxy.js";


async function canConnect(address: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address, port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function assertGrpcNotLanExposed(port: number) {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => !entry.internal && entry.family === "IPv4")
    .map((entry) => entry.address);

  for (const address of addresses) {
    if (await canConnect(address, port)) {
      throw new Error(
        `Security check failed: emulator gRPC port ${port} is reachable via LAN address ${address}.`,
      );
    }
  }
}

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

  provisionAndroidTvGuest(tools.adb, serial);

  const requiredSettings = [
    ["global", "device_provisioned"],
    ["secure", "user_setup_complete"],
    ["secure", "tv_user_setup_complete"],
  ];

  for (const [namespace, name] of requiredSettings) {
    const result = run(tools.adb, [
      "-s",
      serial,
      "shell",
      "settings",
      "get",
      namespace,
      name,
    ]);

    if (!result.ok || result.stdout.trim() !== "1") {
      throw new Error(
        `Guest provisioning failed for ${namespace} ${name}: ${result.stderr || result.stdout}`,
      );
    }
  }

  console.log(
    "[runtime-smoke] Guest mode provisioning verified; Google account setup is not required for launcher access.",
  );

  const remoteDiagnostics = [
    ["remote-package", ["shell", "dumpsys", "package", "com.google.android.tv.remote.service"]],
    ["remote-services", ["shell", "dumpsys", "activity", "services", "com.google.android.tv.remote.service"]],
    ["remote-process", ["shell", "pidof", "com.google.android.tv.remote.service"]],
    ["remote-resolve-main", ["shell", "cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "com.google.android.tv.remote.service"]],
  ] as const;

  for (const [name, args] of remoteDiagnostics) {
    const result = run(tools.adb, ["-s", serial, ...args]);
    const output = result.stdout
      .split("\n")
      .filter((line) =>
        /Service|Receiver|Activity|com\.google\.android\.tv\.remote\.service|versionName=|versionCode=|enabled=|exported=|permission=|6466|6467|Remote|Pair/i.test(line),
      )
      .slice(0, 120)
      .join(" | ");
    console.log(
      `[runtime-smoke] diag ${name}: ${output || result.stdout.trim() || result.stderr.trim() || "unavailable"}`,
    );
  }

  try {
    await prepareNativeAndroidTvRemoteService(
      tools.adb,
      serial,
      20_000,
    );
    console.log(
      "[runtime-smoke] Google TV Remote Service is listening on 6466/6467.",
    );
  } catch (error) {
    console.log(
      "[runtime-smoke] Google TV Remote Service readiness probe failed: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const diagnostics = [
    ["model", ["shell", "getprop", "ro.product.model"]],
    ["manufacturer", ["shell", "getprop", "ro.product.manufacturer"]],
    ["fingerprint", ["shell", "getprop", "ro.build.fingerprint"]],
    ["build-tags", ["shell", "getprop", "ro.build.tags"]],
    ["youtube", ["shell", "dumpsys", "package", "com.google.android.youtube.tv"]],
    ["play-store", ["shell", "pm", "path", "com.android.vending"]],
    ["display", ["shell", "dumpsys", "display"]],
  ] as const;

  for (const [name, args] of diagnostics) {
    const result = run(tools.adb, ["-s", serial, ...args]);
    const output = result.stdout
      .split("\n")
      .filter((line) =>
        name === "youtube"
          ? /versionName=|versionCode=|path=/.test(line)
          : name === "display"
            ? /3840|2160|refreshRate|fps|modeId/.test(line)
            : true,
      )
      .slice(0, 20)
      .join(" | ");
    console.log(`[runtime-smoke] diag ${name}: ${output || result.stderr.trim() || "unavailable"}`);
  }

  const endpoint = await waitForEmulatorGrpcEndpoint(serial, 20_000);

  await assertGrpcNotLanExposed(endpoint.port);
  console.log(
    "[runtime-smoke] Secure gRPC discovery found; endpoint is not reachable on non-loopback IPv4 addresses.",
  );

  display = new EmulatorDisplayStream({
    port: endpoint.port,
    address: endpoint.address,
    token: endpoint.token,
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
        bytes: frame.pixels.length,
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

  // Reproduce the real 4K path that previously exceeded gRPC's 4 MiB
  // default receive ceiling. One RGB888 3840x2160 frame is ~24.9 MiB.
  display.stop();
  display = new EmulatorDisplayStream({
    port: endpoint.port,
    address: endpoint.address,
    token: endpoint.token,
    appPath: process.cwd(),
    width: 3840,
    height: 2160,
    maxFps: 1,
  });

  const fourKFrame = new Promise<{
    width: number;
    height: number;
    bytes: number;
  }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for the 4K TV frame.")),
      30_000,
    );

    display!.once("frame", (value) => {
      clearTimeout(timer);
      resolve({
        width: value.width,
        height: value.height,
        bytes: value.pixels.length,
      });
    });

    display!.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await display.start();
  const frame4k = await fourKFrame;

  if (frame4k.width !== 3840 || frame4k.height !== 2160) {
    throw new Error(
      `Expected a 3840x2160 4K frame, received ${frame4k.width}x${frame4k.height}.`,
    );
  }
  if (frame4k.bytes <= 4 * 1024 * 1024) {
    throw new Error(
      `4K frame was unexpectedly small: ${frame4k.bytes} bytes.`,
    );
  }

  console.log(
    `[runtime-smoke] SUCCESS: 4K gRPC frame ${frame4k.width}x${frame4k.height}, ${frame4k.bytes} bytes received above the default 4 MiB ceiling.`,
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
