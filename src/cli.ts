#!/usr/bin/env node
import { Command } from "commander";
import { detectAndroidTools, listAdbDevices, listAvds } from "./android/sdk.js";
import { launchTvEmulator } from "./android/emulator.js";
import { AdbInput } from "./android/adbInput.js";
import { AndroidTvRemoteBridge } from "./remote/server.js";
import {
  NativeAndroidTvRemoteProxy,
  hasNativeAndroidTvRemoteService,
} from "./remote/nativeProxy.js";
import { waitForAndroidBoot, waitForNewAdbDevice, stopEmulator } from "./android/readiness.js";
import { runDoctor } from "./doctor.js";

const program = new Command();

program
  .name("ultimate-tv")
  .description("Ultimate TV OS host launcher and Google TV remote bridge")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check Android SDK, emulator and ADB dependencies")
  .action(() => {
    process.exitCode = runDoctor() ? 0 : 1;
  });

program
  .command("avds")
  .description("List Android virtual devices installed on this computer")
  .action(() => {
    const tools = detectAndroidTools();
    if (!tools.emulator) throw new Error("Android emulator executable not found.");
    for (const avd of listAvds(tools.emulator)) console.log(avd);
  });

program
  .command("start")
  .description("Launch an installed Android TV / Google TV AVD")
  .requiredOption("--avd <name>", "AVD name")
  .option("--cold", "Cold boot instead of loading a snapshot", false)
  .option("--writable-system", "Start with a temporary writable system image", false)
  .action((options) => {
    const tools = detectAndroidTools();
    if (!tools.emulator) throw new Error("Android emulator executable not found.");

    const installed = listAvds(tools.emulator);
    if (!installed.includes(options.avd)) {
      throw new Error(
        `AVD "${options.avd}" is not installed. Available: ${installed.join(", ") || "none"}`,
      );
    }

    const pid = launchTvEmulator({
      emulatorPath: tools.emulator,
      avd: options.avd,
      coldBoot: options.cold,
      writableSystem: options.writableSystem,
    });
    console.log(`Ultimate TV guest launched (pid ${pid ?? "unknown"}).`);
  });


program
  .command("session")
  .description("Launch a TV AVD, wait for boot, then expose it to the Google TV phone remote")
  .requiredOption("--avd <name>", "AVD name")
  .option("--name <name>", "TV name shown to phones", "Ultimate TV OS")
  .option("--cold", "Cold boot instead of loading a snapshot", false)
  .action(async (options) => {
    const tools = detectAndroidTools();
    if (!tools.emulator || !tools.adb) {
      throw new Error("Android emulator and adb are required.");
    }

    const installed = listAvds(tools.emulator);
    if (!installed.includes(options.avd)) {
      throw new Error(
        `AVD "${options.avd}" is not installed. Available: ${installed.join(", ") || "none"}`,
      );
    }

    const before = new Set(listAdbDevices(tools.adb));
    const pid = launchTvEmulator({
      emulatorPath: tools.emulator,
      avd: options.avd,
      coldBoot: options.cold,
    });

    console.log(`TV guest launched (pid ${pid ?? "unknown"}). Waiting for ADB...`);
    const serial = await waitForNewAdbDevice(tools.adb, before);
    console.log(`Android guest detected as ${serial}. Waiting for boot...`);
    await waitForAndroidBoot(tools.adb, serial);
    console.log("Android TV is ready.");

    const nativeRemoteAvailable = hasNativeAndroidTvRemoteService(
      tools.adb,
      serial,
    );

    const bridge = nativeRemoteAvailable
      ? new NativeAndroidTvRemoteProxy(tools.adb, serial, options.name)
      : new AndroidTvRemoteBridge(
          new AdbInput(tools.adb, serial),
          options.name,
        );

    console.log(
      nativeRemoteAvailable
        ? "Native Google Android TV Remote Service detected; using transparent proxy mode."
        : "Native Android TV Remote Service not found; using host compatibility server.",
    );

    await bridge.start();

    const shutdown = async () => {
      console.log("\nStopping Ultimate TV session...");
      await bridge.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("stop")
  .description("Stop a running Android emulator")
  .requiredOption("--serial <serial>", "ADB emulator serial, for example emulator-5554")
  .action((options) => {
    const tools = detectAndroidTools();
    if (!tools.adb) throw new Error("adb executable not found.");
    stopEmulator(tools.adb, options.serial);
    console.log(`Stopped ${options.serial}.`);
  });

program
  .command("remote")
  .description("Advertise this computer to the Google TV phone remote and forward controls via ADB")
  .option("--name <name>", "TV name shown to phones", "Ultimate TV OS")
  .option("--serial <serial>", "ADB device serial; defaults to the first connected emulator")
  .action(async (options) => {
    const tools = detectAndroidTools();
    if (!tools.adb) throw new Error("adb executable not found.");

    const devices = listAdbDevices(tools.adb);
    const serial = options.serial ?? devices[0];
    if (!serial) {
      throw new Error("No Android guest is connected through ADB. Start the TV AVD first.");
    }

    console.log(`Forwarding remote commands to ADB device: ${serial}`);
    const bridge = new AndroidTvRemoteBridge(
      new AdbInput(tools.adb, serial),
      options.name,
    );
    await bridge.start();

    const shutdown = async () => {
      console.log("\nStopping Ultimate TV remote bridge...");
      await bridge.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(`Ultimate TV error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
