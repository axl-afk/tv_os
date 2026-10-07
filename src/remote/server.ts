import crypto from "node:crypto";
import tls, { TLSSocket } from "node:tls";
import { Bonjour } from "bonjour-service";
import { AdbInput } from "../android/adbInput.js";
import { loadOrCreateCertificate } from "./certificates.js";
import {
  PairingMessage,
  RemoteMessage,
  decodeFrames,
  encodeDelimited,
} from "./protocol.js";

const PAIRING_PORT = 6467;
const REMOTE_PORT = 6466;

export function compatibilityPairingOptionPayload() {
  return {
    preferredRole: 1,
    outputEncodings: [{ type: 3, symbolLength: 6 }],
  };
}

export function compatibilitySetActivePayload() {
  return {};
}

export function compatibilityTvConfigurePayload() {
  return {
    code1: 639,
    deviceInfo: {
      vendor: "Ultimate TV",
      model: "Ultimate TV OS",
      unknown1: 1,
      unknown2: "10",
      packageName: "com.google.android.tv.remote.service",
      appVersion: "6.1",
    },
  };
}

type PairingState = {
  expectedSecret?: Buffer;
};

export function shouldInjectRemoteKey(
  keyCode: number,
  direction: number,
): boolean {
  return (
    direction === 3 ||
    direction === 0 ||
    (keyCode === 23 && direction === 1)
  );
}

function certificateKeyParts(cert: unknown) {
  const parsed = cert as { modulus?: string; exponent?: string };
  if (!parsed.modulus || !parsed.exponent) {
    throw new Error("Remote certificate does not expose RSA modulus/exponent.");
  }

  const modulus = Buffer.from(parsed.modulus.replace(/^0x/i, ""), "hex");
  let exponentHex = parsed.exponent.replace(/^0x/i, "");
  if (exponentHex.length % 2) exponentHex = `0${exponentHex}`;

  return { modulus, exponent: Buffer.from(exponentHex, "hex") };
}

function ownCertificateKeyParts(socket: TLSSocket) {
  const cert = socket.getCertificate() as { modulus?: string; exponent?: string } | undefined;
  if (!cert?.modulus || !cert.exponent) {
    throw new Error("Server certificate does not expose RSA modulus/exponent.");
  }

  const modulus = Buffer.from(cert.modulus.replace(/^0x/i, ""), "hex");
  let exponentHex = cert.exponent.replace(/^0x/i, "");
  if (exponentHex.length % 2) exponentHex = `0${exponentHex}`;

  return { modulus, exponent: Buffer.from(exponentHex, "hex") };
}

export class AndroidTvRemoteBridge {
  private bonjour?: Bonjour;
  private pairingServer?: tls.Server;
  private remoteServer?: tls.Server;

  constructor(
    private readonly input: AdbInput,
    private readonly deviceName = "Ultimate TV OS",
    private readonly events: {
      onPairingCode?: (code: string) => void;
      onPaired?: () => void;
    } = {},
  ) {}

  async start() {
    const certs = await loadOrCreateCertificate();
    const tlsOptions = {
      key: certs.key,
      cert: certs.cert,
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2" as const,
    };

    this.pairingServer = tls.createServer(tlsOptions, (socket) =>
      this.handlePairing(socket),
    );
    this.remoteServer = tls.createServer(tlsOptions, (socket) =>
      this.handleRemote(socket),
    );

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.pairingServer!.once("error", reject);
        this.pairingServer!.listen(PAIRING_PORT, "0.0.0.0", () => resolve());
      }),
      new Promise<void>((resolve, reject) => {
        this.remoteServer!.once("error", reject);
        this.remoteServer!.listen(REMOTE_PORT, "0.0.0.0", () => resolve());
      }),
    ]);

    this.bonjour = new Bonjour();
    this.bonjour.publish({
      name: this.deviceName,
      type: "androidtvremote2",
      protocol: "tcp",
      port: REMOTE_PORT,
      txt: {
        bt: "02:55:4C:54:56:01",
      },
    });

    console.log(`[remote] Advertising "${this.deviceName}" on the local network`);
    console.log(`[remote] Pairing port: ${PAIRING_PORT}; control port: ${REMOTE_PORT}`);
  }

  async stop() {
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();
    await Promise.all([
      new Promise<void>((resolve) => this.pairingServer?.close(() => resolve()) ?? resolve()),
      new Promise<void>((resolve) => this.remoteServer?.close(() => resolve()) ?? resolve()),
    ]);
  }

  private handlePairing(socket: TLSSocket) {
    console.log(`[pairing] phone connected from ${socket.remoteAddress}`);
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const state: PairingState = {};

    socket.on("data", (chunk) => {
      console.log(
        `[pairing] RX ${chunk.length} bytes: ${Buffer.from(chunk).toString("hex")}`,
      );
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = decodeFrames(PairingMessage, buffer);
      buffer = parsed.rest;

      for (const raw of parsed.messages) {
        const msg = PairingMessage.toObject(raw, {
          longs: Number,
          enums: Number,
          bytes: Buffer,
        }) as Record<string, any>;

        console.log("[pairing] decoded:", JSON.stringify(msg));

        if (msg.pairingRequest) {
          socket.write(
            encodeDelimited(PairingMessage, {
              protocolVersion: 2,
              status: 200,
              pairingRequestAck: { serverName: this.deviceName },
            }),
          );
          continue;
        }

        if (msg.pairingOption) {
          socket.write(
            encodeDelimited(PairingMessage, {
              protocolVersion: 2,
              status: 200,
              pairingOption: compatibilityPairingOptionPayload(),
            }),
          );
          continue;
        }

        if (msg.pairingConfiguration) {
          try {
            const nonce = crypto.randomBytes(2);
            const client = certificateKeyParts(socket.getPeerCertificate(true));
            const server = ownCertificateKeyParts(socket);

            const secret = crypto
              .createHash("sha256")
              .update(client.modulus)
              .update(client.exponent)
              .update(server.modulus)
              .update(server.exponent)
              .update(nonce)
              .digest();

            state.expectedSecret = secret;
            const pin = Buffer.concat([secret.subarray(0, 1), nonce])
              .toString("hex")
              .toUpperCase();

            console.log("");
            console.log("====================================");
            console.log(` Ultimate TV pairing code: ${pin}`);
            console.log("====================================");
            console.log("");
            this.events.onPairingCode?.(pin);

            socket.write(
              encodeDelimited(PairingMessage, {
                protocolVersion: 2,
                status: 200,
                pairingConfigurationAck: {},
              }),
            );
          } catch (error) {
            console.error("[pairing] unable to create pairing code:", error);
            socket.destroy();
          }
          continue;
        }

        if (msg.pairingSecret) {
          const received = Buffer.from(msg.pairingSecret.secret ?? []);
          const valid =
            state.expectedSecret !== undefined &&
            received.length === state.expectedSecret.length &&
            crypto.timingSafeEqual(received, state.expectedSecret);

          socket.write(
            encodeDelimited(PairingMessage, {
              protocolVersion: 2,
              status: valid ? 200 : 402,
              pairingSecretAck: {
                secret: state.expectedSecret ?? Buffer.alloc(0),
              },
            }),
          );

          console.log(valid ? "[pairing] phone paired" : "[pairing] invalid pairing secret");
          if (valid) this.events.onPaired?.();
        }
      }
    });

    socket.on("end", () => console.log("[pairing] phone ended connection"));
    socket.on("close", (hadError) =>
      console.log(`[pairing] connection closed (error=${hadError})`),
    );
    socket.on("error", (error) =>
      console.error("[pairing] socket error:", error.message),
    );
  }

  private handleRemote(socket: TLSSocket) {
    console.log(`[remote] control connection from ${socket.remoteAddress}`);
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let ping = 1;

    // A real TV speaks first and advertises TV-side protocol capabilities.
    // Values in the 637/639 range are used by current Android/Google TV
    // Remote Service builds. 639 covers ping, keys, IME, power, volume and
    // app-link capabilities expected by the Google TV mobile app.
    socket.write(
      encodeDelimited(RemoteMessage, {
        remoteConfigure: compatibilityTvConfigurePayload(),
      }),
    );

    const timer = setInterval(() => {
      socket.write(
        encodeDelimited(RemoteMessage, {
          remotePingRequest: { val1: ping++ },
        }),
      );
    }, 5000);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = decodeFrames(RemoteMessage, buffer);
      buffer = parsed.rest;

      for (const raw of parsed.messages) {
        const msg = RemoteMessage.toObject(raw, {
          longs: Number,
          enums: Number,
          bytes: Buffer,
        }) as Record<string, any>;

        if (msg.remoteConfigure) {
          // Current Google TV clients answer the TV's configuration first.
          // The TV then asks the client to mark that capability set active.
          // Preserve the handshake used by the last swipe-working build.
          // Advertising the feature mask here caused current Google TV phone
          // clients to treat touchpad gestures as keyboard/tab navigation.
          socket.write(
            encodeDelimited(RemoteMessage, {
              remoteSetActive: compatibilitySetActivePayload(),
            }),
          );
        } else if (msg.remoteSetActive) {
          socket.write(
            encodeDelimited(RemoteMessage, {
              remoteStart: { started: true },
            }),
          );
        } else if (msg.remoteKeyInject) {
          const keyCode = Number(msg.remoteKeyInject.keyCode);
          const direction = Number(msg.remoteKeyInject.direction);

          // Android TV Remote v2 uses SHORT=3 for a tap/press.
          // Some clients transiently send UNKNOWN=0. For DPAD_CENTER,
          // START_LONG=1 should also activate the focused control immediately
          // so touchpad taps cannot connect without selecting.
          const shouldInject =
            Number.isFinite(keyCode) &&
            shouldInjectRemoteKey(keyCode, direction);

          if (shouldInject) {
            try {
              this.input.key(keyCode);
            } catch (error) {
              console.error("[remote] key injection failed:", error);
            }
          }
        } else if (msg.remotePingRequest) {
          socket.write(
            encodeDelimited(RemoteMessage, {
              remotePingResponse: {
                val1: msg.remotePingRequest.val1 ?? 0,
              },
            }),
          );
        } else if (msg.remoteImeBatchEdit?.editInfo?.insert) {
          try {
            this.input.text(
              String(msg.remoteImeBatchEdit.editInfo.insert),
            );
          } catch (error) {
            console.error("[remote] IME text injection failed:", error);
          }
        }
      }
    });

    socket.on("close", () => clearInterval(timer));
    socket.on("error", (error) =>
      console.error("[remote] socket error:", error.message),
    );
  }
}
