import { EventEmitter } from "node:events";
import { detectAndroidTools, listAdbDevices, listAvds } from "../android/sdk.js";
import { launchTvEmulator } from "../android/emulator.js";
import { AdbInput } from "../android/adbInput.js";
import { waitForAndroidBoot, waitForNewAdbDevice, stopEmulator } from "../android/readiness.js";
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
  message?: string;
};

export type StartSessionOptions = {
  avd: string;
  deviceName?: string;
  coldBoot?: boolean;
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
    return listAvds(tools.emulator);
  }

  async start(options: StartSessionOptions): Promise<SessionSnapshot> {
    if (this.snapshot.state !== "idle" && this.snapshot.state !== "error") {
      throw new Error("An Ultimate TV session is already active.");
    }

    const tools = detectAndroidTools();
    if (!tools.emulator || !tools.adb) {
      throw new Error(
        "Android Emulator and ADB were not found. Install Android Studio and the Android SDK tools first.",
      );
    }

    const installed = listAvds(tools.emulator);
    if (!installed.includes(options.avd)) {
      throw new Error(
        `AVD "${options.avd}" is not installed. Available: ${installed.join(", ") || "none"}`,
      );
    }

    this.adbPath = tools.adb;

    try {
      this.setState({
        state: "starting",
        avd: options.avd,
        message: "Launching TV guest…",
      });

      const before = new Set(listAdbDevices(tools.adb));
      const pid = launchTvEmulator({
        emulatorPath: tools.emulator,
        avd: options.avd,
        coldBoot: options.coldBoot,
      });

      this.setState({
        state: "waiting-adb",
        avd: options.avd,
        pid,
        message: "Waiting for Android Debug Bridge…",
      });

      const serial = await waitForNewAdbDevice(tools.adb, before);

      this.setState({
        state: "booting",
        avd: options.avd,
        serial,
        pid,
        message: "Android TV is booting…",
      });

      await waitForAndroidBoot(tools.adb, serial);

      this.setState({
        state: "starting-remote",
        avd: options.avd,
        serial,
        pid,
        message: "Starting Google TV phone remote bridge…",
      });

      const nativeRemote = hasNativeAndroidTvRemoteService(tools.adb, serial);
      this.bridge = nativeRemote
        ? new NativeAndroidTvRemoteProxy(
            tools.adb,
            serial,
            options.deviceName ?? "Ultimate TV OS",
          )
        : new AndroidTvRemoteBridge(
            new AdbInput(tools.adb, serial),
            options.deviceName ?? "Ultimate TV OS",
          );

      await this.bridge.start();

      this.setState({
        state: "running",
        avd: options.avd,
        serial,
        pid,
        remoteMode: nativeRemote ? "native" : "compatibility",
        message: nativeRemote
          ? "TV is ready. Google TV remote is available on your LAN."
          : "TV is ready using compatibility remote mode.",
      });

      return this.status();
    } catch (error) {
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
          // The user may already have closed the emulator window.
        }
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
