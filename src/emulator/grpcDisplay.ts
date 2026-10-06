import path from "node:path";
import { EventEmitter } from "node:events";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export type TvFrame = {
  png: Buffer;
  width: number;
  height: number;
  sequence: number;
  timestampUs?: string;
};

export type GrpcDisplayOptions = {
  port: number;
  appPath: string;
  token?: string;
  address?: string;
  width?: number;
  height?: number;
  maxFps?: number;
};

export class EmulatorDisplayStream extends EventEmitter {
  private client?: any;
  private call?: grpc.ClientReadableStream<any>;
  private stopped = false;
  private lastFrameAt = 0;

  constructor(private readonly options: GrpcDisplayOptions) {
    super();
  }

  async start(): Promise<void> {
    this.stopped = false;

    const protoPath = path.join(
      this.options.appPath,
      "proto",
      "emulator_controller.proto",
    );

    const definition = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
    });

    const loaded = grpc.loadPackageDefinition(definition) as any;
    const Controller =
      loaded?.android?.emulation?.control?.EmulatorController;

    if (!Controller) {
      throw new Error("Unable to load Android Emulator gRPC controller.");
    }

    const target =
      this.options.address?.trim() ||
      `localhost:${this.options.port}`;

    const client = new Controller(
      target,
      grpc.credentials.createInsecure(),
    );
    this.client = client;

    await new Promise<void>((resolve, reject) => {
      const deadline = new Date(Date.now() + 15_000);
      grpc.waitForClientReady(client, deadline, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const width = this.options.width ?? 1920;
    const height = this.options.height ?? 1080;
    const maxFps = Math.max(1, this.options.maxFps ?? 30);
    const minimumGapMs = 1000 / maxFps;

    const metadata = new grpc.Metadata();
    if (this.options.token) {
      metadata.set(
        "authorization",
        `Bearer ${this.options.token}`,
      );
    }

    const call = client.streamScreenshot(
      {
        format: 0,
        width,
        height,
        display: 0,
      },
      metadata,
    );
    this.call = call;

    call.on("data", (image: any) => {
      if (this.stopped) return;

      const now = Date.now();
      if (now - this.lastFrameAt < minimumGapMs) return;

      const bytes = image?.image;
      if (!bytes || bytes.length === 0) return;

      this.lastFrameAt = now;

      const frameWidth =
        Number(image?.format?.width ?? image?.width ?? width) || width;
      const frameHeight =
        Number(image?.format?.height ?? image?.height ?? height) || height;

      const frame: TvFrame = {
        png: Buffer.from(bytes),
        width: frameWidth,
        height: frameHeight,
        sequence: Number(image?.seq ?? 0),
        timestampUs:
          image?.timestampUs !== undefined
            ? String(image.timestampUs)
            : undefined,
      };

      this.emit("frame", frame);
    });

    call.on("error", (error: grpc.ServiceError) => {
      if (this.stopped || error.code === grpc.status.CANCELLED) return;
      this.emit("error", error);
    });

    call.on("end", () => {
      if (!this.stopped) this.emit("end");
    });
  }

  stop() {
    this.stopped = true;
    try {
      this.call?.cancel();
    } catch {}
    this.call = undefined;

    try {
      this.client?.close();
    } catch {}
    this.client = undefined;
  }
}
