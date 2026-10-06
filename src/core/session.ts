import path from "node:path";
import { EventEmitter } from "node:events";
import { detectAndroidTools, listAdbDevices, listAvds } from "../android/sdk.js";
import { checkEmulatorAcceleration, launchTvEmulator } from "../android/emulator.js";
import { AdbInput } from "../android/adbInput.js";
import { provisionAndroidTvGuest } from "../android/provision.js";
import { waitForAndroidBoot, waitForNewAdbDevice, stopEmulator, stopRunningAvdInstances, getAndroidDisplaySize } from "../android/readiness.js";
import { requestEmulatorFullscreen } from "../host/fullscreen.js";
import { reserveFreeLoopbackPort } from "../lib/network.js";
import { terminateProcessTree } from "../lib/process.js";
import { runtimeRoot } from "../runtime/paths.js";
import {
  applyRuntimeGoogleTvProfile,
  applyRuntimeStoragePolicy,
  runtimeFreeSpaceBytes,
} from "../runtime/storage.js";
import { AndroidTvRemoteBridge } from "../remote/server.js";
import {
  NativeAndroidTvRemoteProxy,
  hasNativeAndroidTvRemoteService,
} from "../remote/nativeProxy.js";

export type SessionState =
  | "idle"
  | "starting"
  | "waiting-adb"
  | "booting"
  | "starting-remote"
  | "running"
  | "stopping"
  | "error";

export type SessionSnapshot = {
  state: SessionState;
  avd?: string;
  serial?: string;
  pid?: number;
  remoteMode?: "native" | "compatibility";
  pairingCode?: string;
  embedded?: boolean;
  grpcPort?: number;
  displayWidth?: number;
  displayHeight?: number;
  message?: string;
};

export type StartSessionOptions = {
  avd: string;
  deviceName?: string;
  coldBoot?: boolean;
  fullscreen?: boolean;
  embedded?: boolean;
  remoteMode?: "off" | "auto" | "native" | "compatibility";
  gpuMode?: string;
};

type StoppableBridge = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export class UltimateTvSession extends EventEmitter {
  private snapshot: SessionSnapshot = { state: "idle" };
  private bridge?: StoppableBridge;
  private adbPath?: string;

  status(): SessionSnapshot {
    return { ...this.snapshot };
  }

  availableAvds(): string[] {
    const tools = detectAndroidTools();
    if (!tools.emulator) return [];
    return listAvds(tools.emulator, tools.environment);
  }

  async start(options: StartSessionOptions): Promise<SessionSnapshot> {
    if (this.snapshot.state !== "idle" && this.snapshot.state !== "error") {
      throw new Error("An Ultimate TV session is already active.");
    }

    const tools = detectAndroidTools();
    if (!tools.emulator || !tools.adb) {
      throw new Error(
        "Ultimate TV runtime is not installed. Install it from the Ultimate TV OS app first.",
      );
    }

    const installed = listAvds(tools.emulator, tools.environment);
    if (!installed.includes(options.avd)) {
      throw new Error(
        `AVD "${options.avd}" is not installed. Available: ${installed.join(", ") || "none"}`,
      );
    }

    this.adbPath = tools.adb;

    applyRuntimeStoragePolicy();
    applyRuntimeGoogleTvProfile();

    const freeBytes = runtimeFreeSpaceBytes();
    if (freeBytes !== null && freeBytes < 6 * 1024 * 1024 * 1024) {
      throw new Error(
        "Not enough free disk space to start Ultimate TV safely. " +
          "Free at least 6 GB, then try again.",
      );
    }

    const acceleration = checkEmulatorAcceleration(
      tools.emulator,
      tools.environment,
    );
    if (!acceleration.ok) {
      throw new Error(
        "Android Emulator hardware acceleration is unavailable.\n\n" +
          acceleration.detail,
      );
    }

    // A previous crash can leave our private AVD alive. Clear only instances
    // with this exact AVD name so Start TV remains deterministic.
    await stopRunningAvdInstances(tools.adb, options.avd);

    let launchedPid: number | undefined;

    try {
      this.setState({
        state: "starting",
        avd: options.avd,
        message: "Launching TV guest…",
      });

      const before = new Set(listAdbDevices(tools.adb, tools.environment));
      const embedded = options.embedded === true;
      const grpcPort = embedded ? await reserveFreeLoopbackPort() : undefined;

      const emulatorLogFile = path.join(
        runtimeRoot(),
        "logs",
        "emulator-last.log",
      );

      const pid = launchTvEmulator({
        emulatorPath: tools.emulator,
        avd: options.avd,
        coldBoot: options.coldBoot,
        headless: embedded,
        grpcPort,
        gpuMode: options.gpuMode,
        environment: tools.environment,
        logFile: emulatorLogFile,
      });
      launchedPid = pid;

      this.setState({
        state: "waiting-adb",
        avd: options.avd,
        pid,
        embedded,
        grpcPort,
        message: embedded
          ? "Starting hidden TV engine…"
          : "Waiting for Android Debug Bridge…",
      });

      const serial = await waitForNewAdbDevice(
        tools.adb,
        before,
        120_000,
        tools.environment,
        pid,
        emulatorLogFile,
      );

      this.setState({
        state: "booting",
        avd: options.avd,
        serial,
        pid,
        embedded,
        grpcPort,
        message: embedded
          ? "Google TV is booting inside Ultimate TV…"
          : "Android TV is booting…",
      });

      await waitForAndroidBoot(tools.adb, serial);

      this.setState({
        ...this.snapshot,
        state: "booting",
        message: "Preparing Google TV guest mode…",
      });

      provisionAndroidTvGuest(tools.adb, serial);
      const displaySize = getAndroidDisplaySize(tools.adb, serial);

      const fullscreen = embedded
        ? { ok: true, message: "Ultimate TV owns the fullscreen surface." }
        : options.fullscreen !== false
          ? requestEmulatorFullscreen(options.avd)
          : { ok: false, message: "Fullscreen disabled." };

      this.setState({
        state: "starting-remote",
        avd: options.avd,
        serial,
        pid,
        embedded,
        grpcPort,
        displayWidth: displaySize.width,
        displayHeight: displaySize.height,
        message: embedded
          ? "TV engine is ready. Preparing the Ultimate TV screen…"
          : fullscreen.ok
            ? "TV is fullscreen. Starting phone remote…"
            : `Starting phone remote… ${fullscreen.message}`,
      });

      const preference = options.remoteMode ?? "auto";
      let activeRemoteMode: "native" | "compatibility" | undefined;
      let remoteMessage = "Phone remote disabled.";

      if (preference !== "off") {
        const nativeRemoteAvailable =
          hasNativeAndroidTvRemoteService(tools.adb, serial);

        const useNative =
          preference === "native" ||
          (preference === "auto" && nativeRemoteAvailable);

        if (preference === "native" && !nativeRemoteAvailable) {
          remoteMessage = "Native Google phone remote service is unavailable in this image.";
        } else {
          this.bridge = useNative
            ? new NativeAndroidTvRemoteProxy(
                tools.adb,
                serial,
                options.deviceName ?? "Ultimate TV OS",
              )
            : new AndroidTvRemoteBridge(
                new AdbInput(tools.adb, serial),
                options.deviceName ?? "Ultimate TV OS",
                {
                  onPairingCode: (pairingCode) => {
                    this.setState({
                      ...this.snapshot,
                      pairingCode,
                      message: `Enter pairing code ${pairingCode} in the Google TV phone remote.`,
                    });
                  },
                  onPaired: () => {
                    this.setState({
                      ...this.snapshot,
                      pairingCode: undefined,
                      message: "Phone paired.",
                    });
                  },
                },
              );

          try {
            await this.bridge.start();
            activeRemoteMode = useNative ? "native" : "compatibility";
            remoteMessage = useNative
              ? "Native Google phone remote is available."
              : "Compatibility phone remote is available.";
          } catch (error) {
            const nativeError =
              error instanceof Error ? error.message : String(error);

            this.bridge = undefined;

            if (useNative && preference === "auto") {
              const fallback = new AndroidTvRemoteBridge(
                new AdbInput(tools.adb, serial),
                options.deviceName ?? "Ultimate TV OS",
                {
                  onPairingCode: (pairingCode) => {
                    this.setState({
                      ...this.snapshot,
                      pairingCode,
                      message: `Enter pairing code ${pairingCode} in the Google TV phone remote.`,
                    });
                  },
                  onPaired: () => {
                    this.setState({
                      ...this.snapshot,
                      pairingCode: undefined,
                      message: "Phone paired through compatibility remote.",
                    });
                  },
                },
              );

              try {
                await fallback.start();
                this.bridge = fallback;
                activeRemoteMode = "compatibility";
                remoteMessage =
                  "Compatibility phone remote is available (native Google service did not start).";
              } catch (fallbackError) {
                remoteMessage =
                  "TV started, but both phone remote backends failed. Native: " +
                  nativeError +
                  " Compatibility: " +
                  (fallbackError instanceof Error
                    ? fallbackError.message
                    : String(fallbackError));
              }
            } else {
              remoteMessage =
                "TV started, but phone remote is unavailable: " +
                nativeError;
            }
          }
        }
      }

      this.setState({
        state: "running",
        avd: options.avd,
        serial,
        pid,
        embedded,
        grpcPort,
        displayWidth: displaySize.width,
        displayHeight: displaySize.height,
        remoteMode: activeRemoteMode,
        message: embedded
          ? `Ultimate TV is ready. ${remoteMessage}`
          : `TV is ready. ${fullscreen.message} ${remoteMessage}`,
      });

      return this.status();
    } catch (error) {
      try {
        await this.bridge?.stop();
      } catch {}
      this.bridge = undefined;

      const serial = this.snapshot.serial;
      if (serial && this.adbPath) {
        try {
          stopEmulator(this.adbPath, serial);
        } catch {
          terminateProcessTree(launchedPid);
        }
      } else {
        terminateProcessTree(launchedPid);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.setState({
        ...this.snapshot,
        state: "error",
        message,
      });
      throw error;
    }
  }

  async stop(): Promise<SessionSnapshot> {
    if (this.snapshot.state === "idle") return this.status();

    const serial = this.snapshot.serial;
    this.setState({
      ...this.snapshot,
      state: "stopping",
      message: "Stopping Ultimate TV…",
    });

    try {
      await this.bridge?.stop();
    } finally {
      this.bridge = undefined;

      if (serial && this.adbPath) {
        try {
          stopEmulator(this.adbPath, serial);
        } catch {
          terminateProcessTree(this.snapshot.pid);
        }
      } else {
        terminateProcessTree(this.snapshot.pid);
      }

      this.adbPath = undefined;
      this.setState({ state: "idle", message: "Ultimate TV is stopped." });
    }

    return this.status();
  }

  private setState(next: SessionSnapshot) {
    this.snapshot = next;
    this.emit("status", this.status());
  }
}
