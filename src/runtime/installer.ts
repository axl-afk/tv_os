import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import {
  RUNTIME_AVD_NAME,
  privateRuntimeReady,
  runtimeAvdDir,
  runtimeAvdHome,
  runtimeAvdIni,
  runtimeDownloads,
  runtimeExecutable,
  runtimeMetadataPath,
  runtimeRoot,
  runtimeSdkRoot,
} from "./paths.js";
import { runtimeHostArch } from "./host.js";
import {
  discoverLatestEmulator,
  discoverLatestGoogleTvImage,
  discoverLatestPlatformTools,
  type RuntimeArtifact,
} from "./repository.js";

export type RuntimeInstallState =
  | "not-installed"
  | "checking"
  | "downloading"
  | "extracting"
  | "configuring"
  | "ready"
  | "error";

export type RuntimeInstallSnapshot = {
  state: RuntimeInstallState;
  stage?: string;
  progress?: number;
  message: string;
  ready: boolean;
  runtimeRoot: string;
  systemImage?: string;
};

type RuntimeMetadata = {
  installedAt: string;
  emulatorUrl: string;
  systemImagePackage: string;
  apiLevel: number;
  abi: string;
};

function ensureSupportedHost() {
  if (!["darwin", "win32", "linux"].includes(process.platform)) {
    throw new Error("Ultimate TV runtime installation is unsupported on this operating system.");
  }
  const hardwareArch = runtimeHostArch();
  if (process.platform !== "darwin" && hardwareArch !== "x64") {
    throw new Error("This build currently supports x64 on Windows/Linux and arm64/x64 on macOS.");
  }
}

function checksumAlgorithm(artifact: RuntimeArtifact): string | null {
  const explicit = artifact.checksumType?.toLowerCase();
  if (explicit === "sha1" || explicit === "sha256") return explicit;
  if (artifact.checksum?.length === 40) return "sha1";
  if (artifact.checksum?.length === 64) return "sha256";
  return null;
}

async function fileChecksum(file: string, algorithm: string): Promise<string> {
  const hash = crypto.createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function safeArchivePath(root: string, entryName: string): string {
  if (entryName.includes("\0")) throw new Error("Unsafe ZIP entry.");
  const normalized = entryName.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error("Blocked unsafe ZIP path: " + entryName);
  }

  const rootPath = path.resolve(root);
  const output = path.resolve(rootPath, normalized);
  if (output !== rootPath && !output.startsWith(rootPath + path.sep)) {
    throw new Error("Blocked ZIP path traversal: " + entryName);
  }
  return output;
}

function openZip(file: string): Promise<any> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: true }, (error, zipfile) => {
      if (error || !zipfile) reject(error ?? new Error("Unable to open ZIP archive."));
      else resolve(zipfile);
    });
  });
}

function openEntryStream(zipfile: any, entry: any): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (error || !stream) reject(error ?? new Error("Unable to read ZIP entry."));
      else resolve(stream);
    });
  });
}

async function readSmallStream(stream: NodeJS.ReadableStream, limit = 16_384): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of stream as any) {
    const chunk = Buffer.from(raw);
    size += chunk.length;
    if (size > limit) throw new Error("ZIP symlink target is unexpectedly large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function extractEntry(zipfile: any, entry: any, root: string) {
  const output = safeArchivePath(root, entry.fileName);
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = mode & 0o170000;
  const isDirectory = entry.fileName.endsWith("/") || type === 0o040000;
  const isSymlink = type === 0o120000;

  if (isDirectory) {
    await fsp.mkdir(output, { recursive: true });
    return;
  }

  await fsp.mkdir(path.dirname(output), { recursive: true });
  const stream = await openEntryStream(zipfile, entry);

  if (isSymlink) {
    if (process.platform === "win32") {
      throw new Error("Runtime archive contains a symlink unsupported by this Windows installer.");
    }
    const target = (await readSmallStream(stream)).toString("utf8");
    const resolvedTarget = path.resolve(path.dirname(output), target);
    const rootPath = path.resolve(root);
    if (resolvedTarget !== rootPath && !resolvedTarget.startsWith(rootPath + path.sep)) {
      throw new Error("Blocked unsafe ZIP symlink: " + entry.fileName);
    }
    await fsp.rm(output, { force: true });
    await fsp.symlink(target, output);
    return;
  }

  await pipeline(stream as any, fs.createWriteStream(output, { mode: mode ? mode & 0o777 : 0o644 }));

  if (process.platform !== "win32" && mode) {
    await fsp.chmod(output, mode & 0o777);
  }
}

async function extractZipSecure(file: string, destination: string) {
  await fsp.mkdir(destination, { recursive: true });
  const zipfile = await openZip(file);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try { zipfile.close(); } catch {}
      reject(error);
    };

    zipfile.on("error", fail);
    zipfile.on("end", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });

    zipfile.on("entry", (entry: any) => {
      void extractEntry(zipfile, entry, destination)
        .then(() => zipfile.readEntry())
        .catch(fail);
    });

    zipfile.readEntry();
  });
}

async function moveChildrenUp(from: string, to: string) {
  const entries = await fsp.readdir(from);
  for (const entry of entries) {
    await fsp.rename(path.join(from, entry), path.join(to, entry));
  }
  await fsp.rm(from, { recursive: true, force: true });
}

async function normalizeSystemImage(destination: string) {
  if (fs.existsSync(path.join(destination, "system.img"))) return;
  const entries = await fsp.readdir(destination, { withFileTypes: true });
  const nested = entries.find(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(destination, entry.name, "system.img")),
  );
  if (nested) await moveChildrenUp(path.join(destination, nested.name), destination);

  if (!fs.existsSync(path.join(destination, "system.img"))) {
    throw new Error("Downloaded Google TV image did not contain system.img.");
  }
}

function avdConfig(apiLevel: number, abi: string): string {
  const cpuArch = abi === "arm64-v8a" ? "arm64" : "x86_64";
  return [
    "AvdId=" + RUNTIME_AVD_NAME,
    "PlayStore.enabled=true",
    "abi.type=" + abi,
    "avd.ini.displayname=Ultimate TV OS",
    "avd.ini.encoding=UTF-8",
    "disk.dataPartition.size=4G",
    "fastboot.forceColdBoot=no",
    "fastboot.forceFastBoot=yes",
    "hw.accelerometer=no",
    "hw.arc=false",
    "hw.audioInput=yes",
    "hw.battery=no",
    "hw.camera.back=none",
    "hw.camera.front=none",
    "hw.cpu.arch=" + cpuArch,
    "hw.cpu.ncore=4",
    "hw.dPad=yes",
    "hw.gps=no",
    "hw.gpu.enabled=yes",
    "hw.gpu.mode=auto",
    "hw.keyboard=yes",
    "hw.lcd.density=320",
    "hw.lcd.height=2160",
    "hw.lcd.width=3840",
    "hw.mainKeys=yes",
    "hw.ramSize=4096",
    "hw.sdCard=no",
    "hw.sensors.orientation=no",
    "hw.trackBall=no",
    "image.sysdir.1=system-images/android-" + apiLevel + "/google-tv/" + abi + "/",
    "runtime.network.latency=none",
    "runtime.network.speed=full",
    "showDeviceFrame=no",
    "skin.dynamic=yes",
    "tag.display=Google TV",
    "tag.id=google-tv",
    "vm.heapSize=512",
    "",
  ].join("\n");
}

export class RuntimeInstaller extends EventEmitter {
  private installing = false;
  private snapshot: RuntimeInstallSnapshot;

  constructor() {
    super();
    const ready = privateRuntimeReady();
    this.snapshot = {
      state: ready ? "ready" : "not-installed",
      ready,
      message: ready ? "Ultimate TV runtime is installed." : "TV runtime is not installed yet.",
      runtimeRoot: runtimeRoot(),
    };
  }

  status(): RuntimeInstallSnapshot {
    const ready = privateRuntimeReady();
    return {
      ...this.snapshot,
      ready,
      state: ready && !this.installing ? "ready" : this.snapshot.state,
    };
  }

  async install(licenseAccepted: boolean): Promise<RuntimeInstallSnapshot> {
    if (!licenseAccepted) {
      throw new Error(
        "You must accept the Android SDK License before downloading Google runtime components.",
      );
    }
    if (this.installing) throw new Error("Runtime installation is already running.");
    ensureSupportedHost();

    this.installing = true;
    try {
      await fsp.mkdir(runtimeSdkRoot(), { recursive: true });
      await fsp.mkdir(runtimeDownloads(), { recursive: true });
      await fsp.mkdir(runtimeAvdHome(), { recursive: true });

      this.update("checking", "repository", undefined, "Checking Google runtime packages…");
      const [emulator, image, platformTools] = await Promise.all([
        discoverLatestEmulator(),
        discoverLatestGoogleTvImage(),
        discoverLatestPlatformTools(),
      ]);

      await fsp.rm(path.join(runtimeSdkRoot(), "platform-tools"), { recursive: true, force: true });
      await this.installZip(platformTools, "platform-tools", runtimeSdkRoot());

      await fsp.rm(path.join(runtimeSdkRoot(), "emulator"), { recursive: true, force: true });
      await this.installZip(emulator, "emulator", runtimeSdkRoot());

      if (!image.apiLevel || !image.abi || !image.packagePath) {
        throw new Error("Google TV image metadata is incomplete.");
      }

      const imageDir = path.join(
        runtimeSdkRoot(),
        "system-images",
        "android-" + image.apiLevel,
        "google-tv",
        image.abi,
      );
      await fsp.rm(imageDir, { recursive: true, force: true });
      await fsp.mkdir(imageDir, { recursive: true });
      await this.installZip(image, "google-tv-image", imageDir);
      await normalizeSystemImage(imageDir);

      this.update("configuring", "virtual-tv", 98, "Creating Ultimate TV virtual hardware…");
      await this.createAvd(image.apiLevel, image.abi);
      await this.ensureExecutableBits();

      const metadata: RuntimeMetadata = {
        installedAt: new Date().toISOString(),
        emulatorUrl: emulator.url,
        systemImagePackage: image.packagePath,
        apiLevel: image.apiLevel,
        abi: image.abi,
      };
      await fsp.writeFile(runtimeMetadataPath(), JSON.stringify(metadata, null, 2) + "\n");

      this.update(
        "ready",
        "complete",
        100,
        "Ultimate TV runtime is ready. Android Studio is not required.",
      );
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update("error", "failed", undefined, message);
      throw error;
    } finally {
      this.installing = false;
    }
  }

  async remove(): Promise<RuntimeInstallSnapshot> {
    if (this.installing) {
      throw new Error("Cannot remove the runtime while installation is active.");
    }
    await fsp.rm(runtimeRoot(), { recursive: true, force: true });
    this.snapshot = {
      state: "not-installed",
      ready: false,
      message: "TV runtime removed.",
      runtimeRoot: runtimeRoot(),
    };
    this.emit("status", this.status());
    return this.status();
  }

  private async installZip(
    artifact: RuntimeArtifact,
    name: string,
    destination: string,
  ) {
    const zipPath = path.join(runtimeDownloads(), name + ".zip");
    await this.download(artifact, zipPath, name);

    this.update(
      "extracting",
      name,
      undefined,
      "Installing " + this.label(name) + "…",
    );
    await extractZipSecure(zipPath, destination);
    await fsp.rm(zipPath, { force: true });
  }

  private async download(
    artifact: RuntimeArtifact,
    destination: string,
    stage: string,
  ) {
    const response = await fetch(artifact.url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(
        "Download failed: " + response.status + " " + response.statusText,
      );
    }

    const total =
      artifact.size ?? Number(response.headers.get("content-length") ?? 0);
    let downloaded = 0;
    let lastPercent = -1;
    const counter = new Transform({
      transform: (chunk, _encoding, callback) => {
        downloaded += chunk.length;
        const percent =
          total > 0
            ? Math.min(100, Math.round((downloaded / total) * 100))
            : undefined;

        if (
          percent === undefined ||
          (percent > lastPercent &&
            (percent >= lastPercent + 2 || percent === 100))
        ) {
          if (percent !== undefined) lastPercent = percent;
          this.update(
            "downloading",
            stage,
            percent,
            "Downloading " +
              this.label(stage) +
              (percent !== undefined ? " — " + percent + "%" : "…"),
          );
        }
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as any),
      counter,
      fs.createWriteStream(destination),
    );

    const algorithm = checksumAlgorithm(artifact);
    if (artifact.checksum && algorithm) {
      const actual = await fileChecksum(destination, algorithm);
      if (actual.toLowerCase() !== artifact.checksum.toLowerCase()) {
        await fsp.rm(destination, { force: true });
        throw new Error(
          "Checksum verification failed for " + this.label(stage) + ".",
        );
      }
    }
  }

  private async createAvd(apiLevel: number, abi: string) {
    const avdDir = runtimeAvdDir();
    await fsp.rm(avdDir, { recursive: true, force: true });
    await fsp.mkdir(avdDir, { recursive: true });
    await fsp.writeFile(
      path.join(avdDir, "config.ini"),
      avdConfig(apiLevel, abi),
    );
    await fsp.writeFile(
      runtimeAvdIni(),
      [
        "avd.ini.encoding=UTF-8",
        "path=" + avdDir,
        "target=android-" + apiLevel,
        "",
      ].join("\n"),
    );
  }

  private async ensureExecutableBits() {
    if (process.platform === "win32") return;
    const candidates = [
      runtimeExecutable("adb"),
      runtimeExecutable("emulator"),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) await fsp.chmod(file, 0o755);
    }
  }

  private label(stage: string): string {
    if (stage === "platform-tools") return "ADB / platform tools";
    if (stage === "emulator") return "TV virtualization engine";
    if (stage === "google-tv-image") return "Google TV system image";
    return stage;
  }

  private update(
    state: RuntimeInstallState,
    stage: string,
    progress: number | undefined,
    message: string,
  ) {
    this.snapshot = {
      state,
      stage,
      progress,
      message,
      ready: privateRuntimeReady(),
      runtimeRoot: runtimeRoot(),
    };
    this.emit("status", this.status());
  }
}
