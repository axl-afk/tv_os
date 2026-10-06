import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import selfsigned from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";
import type { AdbInput } from "../src/android/adbInput.js";
import { AndroidTvRemoteBridge } from "../src/remote/server.js";
import {
  PairingMessage,
  RemoteMessage,
  decodeFrames,
  encodeDelimited,
} from "../src/remote/protocol.js";

class FrameReader {
  private buffer = Buffer.alloc(0);
  private queue: any[] = [];
  private waiters: Array<(value: any) => void> = [];

  constructor(
    socket: tls.TLSSocket,
    private readonly type: any,
  ) {
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const parsed = decodeFrames(this.type, this.buffer);
      this.buffer = parsed.rest;

      for (const message of parsed.messages) {
        const value = this.type.toObject(message, {
          longs: Number,
          enums: Number,
          bytes: Buffer,
        });
        const waiter = this.waiters.shift();
        if (waiter) waiter(value);
        else this.queue.push(value);
      }
    });
  }

  next(timeoutMs = 3000): Promise<any> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for Remote v2 frame.")),
        timeoutMs,
      );
      this.waiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
}

function connectTls(
  port: number,
  key: string,
  cert: string,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      key,
      cert,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function certificateParts(cert: {
  modulus?: string;
  exponent?: string;
}) {
  if (!cert.modulus || !cert.exponent) {
    throw new Error("Test TLS certificate did not expose RSA fields.");
  }

  const modulus = Buffer.from(cert.modulus.replace(/^0x/i, ""), "hex");
  let exponentHex = cert.exponent.replace(/^0x/i, "");
  if (exponentHex.length % 2) exponentHex = "0" + exponentHex;

  return {
    modulus,
    exponent: Buffer.from(exponentHex, "hex"),
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for injected remote key.");
}

describe("host Android TV Remote v2 service", () => {
  const originalHome = process.env.HOME;
  let tempHome: string | undefined;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
      tempHome = undefined;
    }
  });

  it("pairs a phone client and forwards a short key press", async () => {
    tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "ultimate-tv-remote-test-"),
    );
    process.env.HOME = tempHome;

    const pressed: number[] = [];
    const input = {
      key(code: number) {
        pressed.push(code);
      },
      text() {},
    } as unknown as AdbInput;

    let resolveCode!: (code: string) => void;
    const pairingCode = new Promise<string>((resolve) => {
      resolveCode = resolve;
    });

    const bridge = new AndroidTvRemoteBridge(
      input,
      "Ultimate TV OS Test",
      { onPairingCode: resolveCode },
    );

    const clientIdentity = await selfsigned.generate(
      [{ name: "commonName", value: "Google TV Test Remote" }],
      { keySize: 2048, algorithm: "sha256" },
    );

    let pairingSocket: tls.TLSSocket | undefined;
    let remoteSocket: tls.TLSSocket | undefined;

    try {
      await bridge.start();

      pairingSocket = await connectTls(
        6467,
        clientIdentity.private,
        clientIdentity.cert,
      );
      const pairingFrames = new FrameReader(
        pairingSocket,
        PairingMessage,
      );

      pairingSocket.write(
        encodeDelimited(PairingMessage, {
          protocolVersion: 2,
          status: 200,
          pairingRequest: {
            serviceName: "atvremote",
            clientName: "Google TV Test Remote",
          },
        }),
      );
      expect((await pairingFrames.next()).pairingRequestAck)
        .toBeTruthy();

      pairingSocket.write(
        encodeDelimited(PairingMessage, {
          protocolVersion: 2,
          status: 200,
          pairingOption: {
            preferredRole: 1,
            inputEncodings: [{ type: 3, symbolLength: 6 }],
          },
        }),
      );
      const options = await pairingFrames.next();
      expect(options.pairingOption.preferredRole).toBe(1);
      expect(options.pairingOption.outputEncodings[0].symbolLength)
        .toBe(6);

      pairingSocket.write(
        encodeDelimited(PairingMessage, {
          protocolVersion: 2,
          status: 200,
          pairingConfiguration: {
            clientRole: 1,
            encoding: { type: 3, symbolLength: 6 },
          },
        }),
      );

      expect((await pairingFrames.next()).pairingConfigurationAck)
        .toBeTruthy();

      const pin = await pairingCode;
      expect(pin).toMatch(/^[0-9A-F]{6}$/);

      const client = certificateParts(
        pairingSocket.getCertificate() as any,
      );
      const server = certificateParts(
        pairingSocket.getPeerCertificate(true) as any,
      );
      const nonce = Buffer.from(pin.slice(2), "hex");

      const secret = crypto
        .createHash("sha256")
        .update(client.modulus)
        .update(client.exponent)
        .update(server.modulus)
        .update(server.exponent)
        .update(nonce)
        .digest();

      expect(secret[0]).toBe(Number.parseInt(pin.slice(0, 2), 16));

      pairingSocket.write(
        encodeDelimited(PairingMessage, {
          protocolVersion: 2,
          status: 200,
          pairingSecret: { secret },
        }),
      );

      const secretAck = await pairingFrames.next();
      expect(secretAck.status).toBe(200);
      expect(Buffer.from(secretAck.pairingSecretAck.secret))
        .toEqual(secret);

      pairingSocket.end();
      pairingSocket = undefined;

      remoteSocket = await connectTls(
        6466,
        clientIdentity.private,
        clientIdentity.cert,
      );
      const remoteFrames = new FrameReader(
        remoteSocket,
        RemoteMessage,
      );

      const tvConfigure = await remoteFrames.next();
      expect(tvConfigure.remoteConfigure.code1).toBe(639);
      expect(tvConfigure.remoteConfigure.deviceInfo.packageName)
        .toBe("com.google.android.tv.remote.service");

      remoteSocket.write(
        encodeDelimited(RemoteMessage, {
          remoteConfigure: {
            code1: 615,
            deviceInfo: {
              model: "Phone",
              vendor: "Google",
              unknown1: 1,
              unknown2: "1",
              packageName: "com.google.android.apps.tv.launcherx",
              appVersion: "1",
            },
          },
        }),
      );

      expect((await remoteFrames.next()).remoteSetActive)
        .toBeTruthy();

      remoteSocket.write(
        encodeDelimited(RemoteMessage, {
          remoteSetActive: { active: 615 },
        }),
      );

      expect((await remoteFrames.next()).remoteStart.started)
        .toBe(true);

      remoteSocket.write(
        encodeDelimited(RemoteMessage, {
          remoteKeyInject: {
            keyCode: 23,
            direction: 3,
          },
        }),
      );

      await waitFor(() => pressed.includes(23));
      expect(pressed).toContain(23);
    } finally {
      pairingSocket?.destroy();
      remoteSocket?.destroy();
      await bridge.stop();
    }
  }, 15_000);
});
