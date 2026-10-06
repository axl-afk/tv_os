import net from "node:net";
import { Bonjour } from "bonjour-service";
import { run } from "../lib/process.js";

const PUBLIC_REMOTE_PORT = 6466;
const PUBLIC_PAIRING_PORT = 6467;
const REMOTE_SERVICE_PACKAGE = "com.google.android.tv.remote.service";

function adbArgs(serial: string, ...args: string[]) {
  return ["-s", serial, ...args];
}

function createAdbForward(adbPath: string, serial: string, guestPort: number): number {
  const result = run(adbPath, adbArgs(serial, "forward", "tcp:0", `tcp:${guestPort}`));
  if (!result.ok) {
    throw new Error(
      result.stderr.trim() || `Unable to forward Android TV port ${guestPort}`,
    );
  }

  const port = Number(result.stdout.trim());
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `ADB did not return a valid host port for guest port ${guestPort}: ${result.stdout.trim()}`,
    );
  }
  return port;
}

function removeAdbForward(adbPath: string, serial: string, hostPort: number) {
  run(adbPath, adbArgs(serial, "forward", "--remove", `tcp:${hostPort}`));
}

function tcpTunnel(
  publicPort: number,
  targetPort: number,
  label: string,
): Promise<net.Server> {
  const server = net.createServer((phone) => {
    console.log(`[native-remote] ${label} connection from ${phone.remoteAddress}`);

    const guest = net.connect({
      host: "127.0.0.1",
      port: targetPort,
    });

    phone.pipe(guest);
    guest.pipe(phone);

    const closeBoth = () => {
      phone.destroy();
      guest.destroy();
    };

    phone.on("error", (error) =>
      console.error(`[native-remote] phone ${label} socket error: ${error.message}`),
    );
    guest.on("error", (error) => {
      console.error(`[native-remote] guest ${label} socket error: ${error.message}`);
      closeBoth();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(publicPort, "0.0.0.0", () => resolve(server));
  });
}

export function hasNativeAndroidTvRemoteService(
  adbPath: string,
  serial: string,
): boolean {
  const result = run(
    adbPath,
    adbArgs(serial, "shell", "pm", "path", REMOTE_SERVICE_PACKAGE),
  );
  return result.ok && result.stdout.includes("package:");
}

export class NativeAndroidTvRemoteProxy {
  private bonjour?: Bonjour;
  private pairingServer?: net.Server;
  private remoteServer?: net.Server;
  private pairingForward?: number;
  private remoteForward?: number;

  constructor(
    private readonly adbPath: string,
    private readonly serial: string,
    private readonly deviceName = "Ultimate TV OS",
  ) {}

  async start() {
    this.pairingForward = createAdbForward(
      this.adbPath,
      this.serial,
      PUBLIC_PAIRING_PORT,
    );
    this.remoteForward = createAdbForward(
      this.adbPath,
      this.serial,
      PUBLIC_REMOTE_PORT,
    );

    try {
      [this.pairingServer, this.remoteServer] = await Promise.all([
        tcpTunnel(PUBLIC_PAIRING_PORT, this.pairingForward, "pairing"),
        tcpTunnel(PUBLIC_REMOTE_PORT, this.remoteForward, "remote"),
      ]);
    } catch (error) {
      this.cleanupForwards();
      throw error;
    }

    this.bonjour = new Bonjour();
    this.bonjour.publish({
      name: this.deviceName,
      type: "androidtvremote2",
      protocol: "tcp",
      port: PUBLIC_REMOTE_PORT,
      txt: {
        // Real Android TV Remote Service advertisements generally expose a
        // Bluetooth-style identity in the "bt" TXT field. This is a synthetic
        // locally-administered identity for the virtual appliance.
        bt: "02:55:4C:54:56:01",
      },
    });

    console.log("[native-remote] Using Android TV's built-in Google Remote Service.");
    console.log(
      `[native-remote] LAN :${PUBLIC_PAIRING_PORT}/:${PUBLIC_REMOTE_PORT} -> emulator ${this.serial}`,
    );
    console.log(
      `[native-remote] Open the Google TV phone remote and select "${this.deviceName}".`,
    );
  }

  async stop() {
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();

    await Promise.all([
      new Promise<void>((resolve) =>
        this.pairingServer ? this.pairingServer.close(() => resolve()) : resolve(),
      ),
      new Promise<void>((resolve) =>
        this.remoteServer ? this.remoteServer.close(() => resolve()) : resolve(),
      ),
    ]);

    this.cleanupForwards();
  }

  private cleanupForwards() {
    if (this.pairingForward) {
      removeAdbForward(this.adbPath, this.serial, this.pairingForward);
      this.pairingForward = undefined;
    }
    if (this.remoteForward) {
      removeAdbForward(this.adbPath, this.serial, this.remoteForward);
      this.remoteForward = undefined;
    }
  }
}
