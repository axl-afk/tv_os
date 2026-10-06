import crypto from "node:crypto";
import tls, { TLSSocket } from "node:tls";
import { Bonjour } from "bonjour-service";
import type { RemoteInputTarget } from "../android/adbInput.js";
import {
  certificateFingerprint,
  loadOrCreateCertificate,
  loadPairedFingerprints,
  pairingDigest,
  rawCertificateFromPem,
  savePairedFingerprints,
} from "./certificates.js";
import {
  HOST_REMOTE_FEATURES,
  PairingMessage,
  RemoteMessage,
  decodeFrames,
  encodeDelimited,
} from "./protocol.js";

const DEFAULT_PAIRING_PORT = 6467;
const DEFAULT_REMOTE_PORT = 6466;

type PairingState = {
  expectedSecret?: Buffer;
  fingerprint?: string;
};

type RemoteStage = "configure" | "active" | "ready";

export type BridgeOptions = {
  deviceName?: string;
  pairingPort?: number;
  remotePort?: number;
  advertise?: boolean;
  stateDir?: string;
  onPairingCode?: (pin: string) => void;
};

export type BridgePorts = {
  pairingPort: number;
  remotePort: number;
};

function peerRawCertificate(socket: TLSSocket): Buffer {
  const cert = socket.getPeerCertificate(true) as { raw?: Buffer };
  if (!cert?.raw?.length) {
    throw new Error("Remote did not present a client certificate.");
  }
  return Buffer.from(cert.raw);
}

function objectMessage(type: typeof PairingMessage | typeof RemoteMessage, raw: unknown) {
  return type.toObject(raw as any, {
    longs: Number,
    enums: Number,
    bytes: Buffer,
    defaults: false,
  }) as Record<string, any>;
}

function write(socket: TLSSocket, type: typeof PairingMessage | typeof RemoteMessage, payload: object) {
  socket.write(encodeDelimited(type, payload));
}

export class AndroidTvRemoteBridge {
  private bonjour?: Bonjour;
  private pairingServer?: tls.Server;
  private remoteServer?: tls.Server;
  private paired = new Set<string>();
  private serverCertificateRaw?: Buffer;
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly deviceName: string;
  private readonly pairingPort: number;
  private readonly remotePort: number;
  private readonly advertise: boolean;
  private readonly stateDir?: string;
  private readonly onPairingCode?: (pin: string) => void;

  constructor(
    private readonly input: RemoteInputTarget,
    options: BridgeOptions | string = {},
  ) {
    if (typeof options === "string") options = { deviceName: options };
    this.deviceName = options.deviceName ?? "Ultimate TV OS";
    this.pairingPort = options.pairingPort ?? DEFAULT_PAIRING_PORT;
    this.remotePort = options.remotePort ?? DEFAULT_REMOTE_PORT;
    this.advertise = options.advertise ?? true;
    this.stateDir = options.stateDir;
    this.onPairingCode = options.onPairingCode;
  }

  async start(): Promise<BridgePorts> {
    const certs = await loadOrCreateCertificate(this.stateDir);
    this.serverCertificateRaw = rawCertificateFromPem(certs.cert);
    this.paired = loadPairedFingerprints(this.stateDir);

    const tlsOptions = {
      key: certs.key,
      cert: certs.cert,
      requestCert: true,
      // Remote v2 clients use self-signed certificates. Trust is established by
      // the visual pairing proof, then pinned by SHA-256 certificate fingerprint.
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
      this.listen(this.pairingServer, this.pairingPort),
      this.listen(this.remoteServer, this.remotePort),
    ]);

    const ports = this.ports();
    if (this.advertise) {
      this.bonjour = new Bonjour();
      this.bonjour.publish({
        name: this.deviceName,
        type: "androidtvremote2",
        protocol: "tcp",
        port: ports.remotePort,
        txt: { txtvers: "1" },
      });
    }

    console.log(`[remote] Advertising "${this.deviceName}" on the local network`);
    console.log(
      `[remote] Pairing port: ${ports.pairingPort}; control port: ${ports.remotePort}`,
    );
    console.log(`[remote] Remembered paired phones: ${this.paired.size}`);
    return ports;
  }

  ports(): BridgePorts {
    const pairing = this.pairingServer?.address();
    const remote = this.remoteServer?.address();
    if (!pairing || typeof pairing === "string" || !remote || typeof remote === "string") {
      return { pairingPort: this.pairingPort, remotePort: this.remotePort };
    }
    return { pairingPort: pairing.port, remotePort: remote.port };
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();
    this.input.dismissPairingPin?.();

    await Promise.all([
      this.closeServer(this.pairingServer),
      this.closeServer(this.remoteServer),
    ]);
  }

  private listen(server: tls.Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    });
  }

  private closeServer(server?: tls.Server): Promise<void> {
    if (!server?.listening) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  private presentPairingCode(pin: string) {
    const shownInGuest = this.input.showPairingPin?.(pin) ?? false;
    if (!shownInGuest) {
      console.log("");
      console.log("====================================");
      console.log(` Ultimate TV pairing code: ${pin}`);
      console.log("====================================");
      console.log("");
    }
    this.onPairingCode?.(pin);
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
        const msg = objectMessage(PairingMessage, raw);

        if (msg.pairingRequest) {
          write(socket, PairingMessage, {
            protocolVersion: 2,
            status: 200,
            pairingRequestAck: { serverName: this.deviceName },
          });
          continue;
        }

        if (msg.pairingOption) {
          // The phone is the input side; the TV displays the code. Real TV
          // services therefore advertise a hexadecimal *output* encoding.
          write(socket, PairingMessage, {
            protocolVersion: 2,
            status: 200,
            pairingOption: {
              preferredRole: 1,
              outputEncodings: [{ type: 3, symbolLength: 6 }],
            },
          });
          continue;
        }

        if (msg.pairingConfiguration) {
          try {
            if (!this.serverCertificateRaw) throw new Error("Server identity is not ready.");
            const clientRaw = peerRawCertificate(socket);
            const nonce = crypto.randomBytes(2);
            const secret = pairingDigest(clientRaw, this.serverCertificateRaw, nonce);
            state.expectedSecret = secret;
            state.fingerprint = certificateFingerprint(clientRaw);

            const pin = Buffer.concat([secret.subarray(0, 1), nonce])
              .toString("hex")
              .toUpperCase();
            this.presentPairingCode(pin);

            write(socket, PairingMessage, {
              protocolVersion: 2,
              status: 200,
              pairingConfigurationAck: {},
            });
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

          write(socket, PairingMessage, {
            protocolVersion: 2,
            status: valid ? 200 : 402,
            pairingSecretAck: {
              secret: state.expectedSecret ?? Buffer.alloc(0),
            },
          });

          if (valid && state.fingerprint) {
            this.paired.add(state.fingerprint);
            savePairedFingerprints(this.paired, this.stateDir);
            this.input.dismissPairingPin?.();
            console.log("[pairing] phone paired and certificate pinned");
          } else {
            console.log("[pairing] invalid pairing secret");
          }

          // One pairing proof per TLS session limits brute-force opportunities and
          // mirrors the one-shot behavior of physical Android TV devices.
          socket.end();
          return;
        }
      }
    });

    socket.on("error", (error) =>
      console.error("[pairing] socket error:", error.message),
    );
  }

  private handleRemote(socket: TLSSocket) {
    let fingerprint: string;
    try {
      fingerprint = certificateFingerprint(peerRawCertificate(socket));
    } catch (error) {
      console.error("[remote] client certificate missing/invalid:", error);
      socket.destroy();
      return;
    }

    if (!this.paired.has(fingerprint)) {
      console.warn(`[remote] rejected unpaired client from ${socket.remoteAddress}`);
      socket.destroy();
      return;
    }

    console.log(`[remote] paired control connection from ${socket.remoteAddress}`);
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stage: RemoteStage = "configure";
    let activeFeatures = HOST_REMOTE_FEATURES;
    let ping = 1;
    let awaitingPong = false;
    let missedPongs = 0;

    write(socket, RemoteMessage, {
      remoteConfigure: {
        code1: HOST_REMOTE_FEATURES,
        deviceInfo: {
          vendor: "Ultimate TV",
          model: "Virtual TV Gen 1",
          unknown1: 1,
          unknown2: "1",
          packageName: "dev.ultimatetv.host",
          appVersion: "0.1.0",
        },
      },
    });

    let timer: NodeJS.Timeout | undefined;
    const startPingLoop = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (socket.destroyed) return;
        if (awaitingPong) missedPongs += 1;
        if (missedPongs >= 3) {
          console.warn("[remote] closing client after three unanswered pings");
          socket.destroy();
          return;
        }
        awaitingPong = true;
        write(socket, RemoteMessage, {
          remotePingRequest: { val1: ping++ },
        });
      }, 5000);
      this.timers.add(timer);
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = decodeFrames(RemoteMessage, buffer);
      buffer = parsed.rest;

      for (const raw of parsed.messages) {
        const msg = objectMessage(RemoteMessage, raw);

        if (msg.remoteConfigure && stage === "configure") {
          const requested = Number(msg.remoteConfigure.code1 ?? HOST_REMOTE_FEATURES);
          activeFeatures = requested & HOST_REMOTE_FEATURES;
          write(socket, RemoteMessage, {
            remoteSetActive: { active: activeFeatures },
          });
          stage = "active";
          continue;
        }

        if (msg.remoteSetActive && stage === "active") {
          activeFeatures = Number(msg.remoteSetActive.active ?? activeFeatures) & activeFeatures;
          write(socket, RemoteMessage, {
            remoteStart: { started: true },
          });
          stage = "ready";
          startPingLoop();
          continue;
        }

        if (msg.remotePingResponse) {
          awaitingPong = false;
          missedPongs = 0;
          continue;
        }

        // Some third-party clients can also initiate pings. Answer them for
        // compatibility even though Google's TV side is normally the pinger.
        if (msg.remotePingRequest) {
          write(socket, RemoteMessage, {
            remotePingResponse: { val1: msg.remotePingRequest.val1 ?? 0 },
          });
          continue;
        }

        if (stage !== "ready") continue;

        if (msg.remoteKeyInject) {
          try {
            this.input.key(
              Number(msg.remoteKeyInject.keyCode),
              Number(msg.remoteKeyInject.direction ?? 3),
            );
          } catch (error) {
            console.error("[remote] key injection failed:", error);
          }
          continue;
        }

        if (msg.remoteImeBatchEdit) {
          const edits = Array.isArray(msg.remoteImeBatchEdit.editInfo)
            ? msg.remoteImeBatchEdit.editInfo
            : msg.remoteImeBatchEdit.editInfo
              ? [msg.remoteImeBatchEdit.editInfo]
              : [];
          for (const edit of edits) {
            const value = edit?.textFieldStatus?.value;
            if (edit?.insert === 1 && typeof value === "string" && value.length) {
              try {
                this.input.text(value);
              } catch (error) {
                console.error("[remote] text injection failed:", error);
              }
            }
          }
          continue;
        }

        const appLink = msg.remoteAppLinkLaunchRequest?.appLink;
        if (typeof appLink === "string" && appLink.length) {
          try {
            this.input.openLink(appLink);
          } catch (error) {
            console.error("[remote] app-link launch failed:", error);
          }
        }
      }
    });

    const cleanup = () => {
      if (timer) {
        clearInterval(timer);
        this.timers.delete(timer);
      }
    };
    socket.on("close", cleanup);
    socket.on("error", (error) => {
      cleanup();
      console.error("[remote] socket error:", error.message);
    });
  }
}
