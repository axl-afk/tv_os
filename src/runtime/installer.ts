import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import extract from "extract-zip";
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
import {
  discoverLatestEmulator,
  discoverLatestGoogleTvImage,
  platformToolsArtifact,
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
  if (process.platform !== "darwin" && process.arch !== "x64") {
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
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
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
}

function avdConfig(apiLevel: number, abi: string): string {
  const cpuArch = abi === "arm64-v8a" ? "arm64" : "x86_64";
  return [
    "AvdId=" + RUNTIME_AVD_NAME,
    "PlayStore.enabled=true",
    "abi.type=" + abi,
    "avd.ini.displayname=Ultimate TV OS",
    "avd.ini.encoding=UTF-8",
    "disk.dataPartition.size=16G",
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
    return { ...this.snapshot, ready, state: ready && !this.installing ? "ready" : this.snapshot.state };
  }

  async install(licenseAccepted: boolean): Promise<RuntimeInstallSnapshot> {
    if (!licenseAccepted) throw new Error("You must accept the Android SDK License before downloading Google runtime components.");
    if (this.installing) throw new Error("Runtime installation is already running.");
    ensureSupportedHost();

    this.installing = true;
    try {
      await fsp.mkdir(runtimeSdkRoot(), { recursive: true });
      await fsp.mkdir(runtimeDownloads(), { recursive: true });
      await fsp.mkdir(runtimeAvdHome(), { recursive: true });

      this.update("checking", "repository", undefined, "Checking Google runtime packages…");
      const [emulator, image] = await Promise.all([
        discoverLatestEmulator(),
        discoverLatestGoogleTvImage(),
      ]);
      const platformTools = platformToolsArtifact();

      await this.installZip(platformTools, "platform-tools", runtimeSdkRoot());
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

      this.update("ready", "complete", 100, "Ultimate TV runtime is ready. Android Studio is not required.");
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
    if (this.installing) throw new Error("Cannot remove the runtime while installation is active.");
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

  private async installZip(artifact: RuntimeArtifact, name: string, destination: string) {
    const zipPath = path.join(runtimeDownloads(), name + ".zip");
    await this.download(artifact, zipPath, name);

    this.update("extracting", name, undefined, "Installing " + this.label(name) + "…");
    await extract(zipPath, { dir: destination });
    await fsp.rm(zipPath, { force: true });
  }

  private async download(artifact: RuntimeArtifact, destination: string, stage: string) {
    const response = await fetch(artifact.url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error("Download failed: " + response.status + " " + response.statusText);
    }

    const total = artifact.size ?? Number(response.headers.get("content-length") ?? 0);
    let downloaded = 0;
    let lastPercent = -1;
    const counter = new Transform({
      transform: (chunk, _encoding, callback) => {
        downloaded += chunk.length;
        const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined;
        if (percent === undefined || percent >= lastPercent + 2 || percent === 100) {
          if (percent !== undefined) lastPercent = percent;
          this.update("downloading", stage, percent, "Downloading " + this.label(stage) + (percent !== undefined ? " — " + percent + "%" : "…"));
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
        throw new Error("Checksum verification failed for " + this.label(stage) + ".");
      }
    }
  }

  private async createAvd(apiLevel: number, abi: string) {
    const avdDir = runtimeAvdDir();
    await fsp.rm(avdDir, { recursive: true, force: true });
    await fsp.mkdir(avdDir, { recursive: true });
    await fsp.writeFile(path.join(avdDir, "config.ini"), avdConfig(apiLevel, abi));
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
    const candidates = [runtimeExecutable("adb"), runtimeExecutable("emulator")];
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
