import crypto from "node:crypto";
import net from "node:net";
import { Bonjour } from "bonjour-service";
import { run } from "../lib/process.js";

const PUBLIC_REMOTE_PORT = 6466;
const PUBLIC_PAIRING_PORT = 6467;
const REMOTE_SERVICE_PACKAGE = "com.google.android.tv.remote.service";

function adbArgs(serial: string, ...args: string[]) {
  return ["-s", serial, ...args];
}

function readGuestValue(
  adbPath: string,
  serial: string,
  args: string[],
): string | null {
  const result = run(adbPath, adbArgs(serial, ...args));
  if (!result.ok) return null;
  const value = result.stdout.trim();
  if (!value || value === "null" || value === "unknown") return null;
  return value;
}

export function remoteAdvertisementIdentity(
  androidId: string | null,
): string {
  const seed = androidId || "ultimate-tv";
  const digest = crypto.createHash("sha256").update(seed).digest();
  const bytes = Buffer.from(digest.subarray(0, 6));

  // Locally administered, unicast MAC-style identifier.
  bytes[0] = (bytes[0] | 0x02) & 0xfe;

  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
}

function guestAdvertisementInfo(
  adbPath: string,
  serial: string,
  deviceName: string,
) {
  const androidId = readGuestValue(adbPath, serial, [
    "shell",
    "settings",
    "get",
    "secure",
    "android_id",
  ]);

  const model =
    readGuestValue(adbPath, serial, [
      "shell",
      "getprop",
      "ro.product.model",
    ]) ?? "Google TV";

  return {
    bt: remoteAdvertisementIdentity(androidId),
    fn: deviceName,
    md: model.toLowerCase().includes("tv") ? model : "Google TV",
  };
}

function prepareNativeRemotePackage(adbPath: string, serial: string) {
  run(
    adbPath,
    adbArgs(
      serial,
      "shell",
      "pm",
      "enable",
      REMOTE_SERVICE_PACKAGE,
    ),
  );
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

async function waitForTcpEndpoint(
  port: number,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.connect({
        host: "127.0.0.1",
        port,
      });

      const done = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(500);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });

    if (reachable) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Android TV Remote Service did not open forwarded port ${port}.`,
  );
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
    prepareNativeRemotePackage(this.adbPath, this.serial);

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
      await Promise.all([
        waitForTcpEndpoint(this.pairingForward),
        waitForTcpEndpoint(this.remoteForward),
      ]);

      [this.pairingServer, this.remoteServer] = await Promise.all([
        tcpTunnel(PUBLIC_PAIRING_PORT, this.pairingForward, "pairing"),
        tcpTunnel(PUBLIC_REMOTE_PORT, this.remoteForward, "remote"),
      ]);
    } catch (error) {
      this.cleanupForwards();
      throw error;
    }

    const identity = guestAdvertisementInfo(
      this.adbPath,
      this.serial,
      this.deviceName,
    );

    this.bonjour = new Bonjour();
    this.bonjour.publish({
      name: this.deviceName,
      type: "androidtvremote2",
      protocol: "tcp",
      port: PUBLIC_REMOTE_PORT,
      txt: identity,
    });

    console.log("[native-remote] Using Android TV's built-in Google Remote Service.");
    console.log(
      `[native-remote] Advertising "${this.deviceName}" as ${identity.md} (${identity.bt}).`,
    );
    console.log(
      `[native-remote] LAN :${PUBLIC_PAIRING_PORT}/:${PUBLIC_REMOTE_PORT} -> emulator ${this.serial}`,
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
