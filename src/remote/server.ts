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

type PairingState = {
  expectedSecret?: Buffer;
};

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
      txt: { txtvers: "1" },
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
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = decodeFrames(PairingMessage, buffer);
      buffer = parsed.rest;

      for (const raw of parsed.messages) {
        const msg = PairingMessage.toObject(raw, {
          longs: Number,
          enums: Number,
          bytes: Buffer,
        }) as Record<string, any>;

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
              pairingOption: {
                preferredRole: 1,
                inputEncodings: [{ type: 3, symbolLength: 6 }],
              },
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
        }
      }
    });

    socket.on("error", (error) =>
      console.error("[pairing] socket error:", error.message),
    );
  }

  private handleRemote(socket: TLSSocket) {
    console.log(`[remote] control connection from ${socket.remoteAddress}`);
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let ping = 1;

    socket.write(
      encodeDelimited(RemoteMessage, {
        remoteConfigure: {
          code1: 622,
          deviceInfo: {
            vendor: "Ultimate TV",
            model: "Virtual TV Gen 1",
            packageName: "dev.ultimatetv.host",
            appVersion: "0.1.0",
          },
        },
      }),
    );

    socket.write(
      encodeDelimited(RemoteMessage, {
        remoteSetActive: { active: 622 },
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

        if (msg.remoteKeyInject) {
          // Direction 3 is a short press in Android TV Remote v2.
          // Long-press start/end are deliberately ignored in v0.1.
          if (msg.remoteKeyInject.direction === 3 || msg.remoteKeyInject.direction === 0) {
            try {
              this.input.key(Number(msg.remoteKeyInject.keyCode));
            } catch (error) {
              console.error("[remote] key injection failed:", error);
            }
          }
        } else if (msg.remotePingRequest) {
          socket.write(
            encodeDelimited(RemoteMessage, {
              remotePingResponse: { val1: msg.remotePingRequest.val1 ?? 0 },
            }),
          );
        } else if (msg.remoteImeBatchEdit?.editInfo?.insert) {
          // IME batching is richer than plain text injection; keep this hook explicit
          // so it can be expanded without pretending full keyboard support exists.
          console.log("[remote] IME edit received (text bridge TODO)");
        }
      }
    });

    socket.on("close", () => clearInterval(timer));
    socket.on("error", (error) =>
      console.error("[remote] socket error:", error.message),
    );
  }
}
