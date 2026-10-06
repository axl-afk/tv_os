import { XMLParser } from "fast-xml-parser";

const GOOGLE_REPOSITORY = "https://dl.google.com/android/repository/";

export type RuntimeArtifact = {
  url: string;
  size?: number;
  checksum?: string;
  checksumType?: string;
  packagePath?: string;
  apiLevel?: number;
  abi?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectRemotePackages(node: unknown, result: any[] = []): any[] {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) {
    for (const item of node) collectRemotePackages(item, result);
    return result;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "remotePackage") result.push(...asArray(value as any));
    else collectRemotePackages(value, result);
  }
  return result;
}

function stablePackage(pkg: any): boolean {
  const ref = pkg?.channelRef?.["@_ref"] ?? pkg?.["channel-ref"]?.["@_ref"] ?? pkg?.channelRef ?? pkg?.["channel-ref"];
  return !ref || ref === "channel-0";
}

function revisionScore(revision: any): number {
  const major = Number(revision?.major ?? 0);
  const minor = Number(revision?.minor ?? 0);
  const micro = Number(revision?.micro ?? 0);
  const preview = Number(revision?.preview ?? 0);
  return major * 1000000000 + minor * 1000000 + micro * 1000 + preview;
}

function hostOs(): string {
  if (process.platform === "darwin") return "macosx";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function hostArch(): string { return process.arch === "arm64" ? "aarch64" : "x86_64"; }
function tvAbi(): string { return process.arch === "arm64" ? "arm64-v8a" : "x86_64"; }

function text(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "#text" in value) return String(value["#text"]);
  return undefined;
}

function archiveToArtifact(archive: any, baseUrl: string, extra: Partial<RuntimeArtifact> = {}): RuntimeArtifact | null {
  const complete = archive?.complete;
  const relativeUrl = text(complete?.url);
  if (!relativeUrl) return null;
  const checksumNode = complete?.checksum;
  const checksum = text(checksumNode);
  const checksumType = checksumNode && typeof checksumNode === "object" ? text(checksumNode?.["@_type"]) : undefined;
  const sizeText = text(complete?.size);
  return {
    url: new URL(relativeUrl, baseUrl).toString(),
    size: sizeText ? Number(sizeText) : undefined,
    checksum,
    checksumType,
    ...extra,
  };
}

async function fetchManifest(urls: string[]): Promise<{ url: string; xml: any }> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) { lastError = new Error(response.status + " " + response.statusText); continue; }
      return { url, xml: parser.parse(await response.text()) };
    } catch (error) { lastError = error; }
  }
  throw new Error("Unable to read Google Android SDK repository: " + String(lastError ?? "unknown error"));
}

function selectHostArchive(pkg: any): any | undefined {
  const archives = asArray(pkg?.archives?.archive);
  const os = hostOs();
  const arch = hostArch();
  const exact = archives.find((archive: any) =>
    text(archive?.["host-os"]) === os &&
    (!text(archive?.["host-arch"]) || text(archive?.["host-arch"]) === arch),
  );
  if (exact) return exact;
  return archives.find((archive: any) => text(archive?.["host-os"]) === os);
}

export function platformToolsArtifact(): RuntimeArtifact {
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  return { url: GOOGLE_REPOSITORY + "platform-tools-latest-" + platform + ".zip" };
}


export async function discoverLatestPlatformTools(): Promise<RuntimeArtifact> {
  const manifest = await fetchManifest([
    GOOGLE_REPOSITORY + "repository2-3.xml",
    GOOGLE_REPOSITORY + "repository2-2.xml",
    GOOGLE_REPOSITORY + "repository2-1.xml",
  ]);

  const packages = collectRemotePackages(manifest.xml)
    .filter((pkg) => pkg?.["@_path"] === "platform-tools")
    .filter(stablePackage)
    .sort((a, b) => revisionScore(b.revision) - revisionScore(a.revision));

  for (const pkg of packages) {
    const archive = selectHostArchive(pkg);
    if (!archive) continue;
    const artifact = archiveToArtifact(archive, GOOGLE_REPOSITORY, {
      packagePath: "platform-tools",
    });
    if (artifact) return artifact;
  }

  return platformToolsArtifact();
}

export async function discoverLatestEmulator(): Promise<RuntimeArtifact> {
  const manifest = await fetchManifest([
    GOOGLE_REPOSITORY + "repository2-3.xml",
    GOOGLE_REPOSITORY + "repository2-2.xml",
    GOOGLE_REPOSITORY + "repository2-1.xml",
  ]);
  const packages = collectRemotePackages(manifest.xml)
    .filter((pkg) => pkg?.["@_path"] === "emulator")
    .filter(stablePackage)
    .sort((a, b) => revisionScore(b.revision) - revisionScore(a.revision));
  for (const pkg of packages) {
    const archive = selectHostArchive(pkg);
    if (!archive) continue;
    const artifact = archiveToArtifact(archive, GOOGLE_REPOSITORY, { packagePath: "emulator" });
    if (artifact) return artifact;
  }
  throw new Error("Google repository did not contain a compatible Android Emulator build.");
}

export async function discoverLatestGoogleTvImage(): Promise<RuntimeArtifact> {
  const abi = tvAbi();
  const base = GOOGLE_REPOSITORY + "sys-img/google-tv/";
  const manifest = await fetchManifest([
    base + "sys-img2-5.xml",
    base + "sys-img2-4.xml",
    base + "sys-img2-3.xml",
    base + "sys-img2-1.xml",
  ]);
  const packages = collectRemotePackages(manifest.xml)
    .filter((pkg) => {
      const packagePath = String(pkg?.["@_path"] ?? "");
      return packagePath.includes(";google-tv;") && packagePath.endsWith(";" + abi);
    })
    .filter(stablePackage)
    .sort((a, b) => {
      const aApi = Number(String(a?.["@_path"] ?? "").match(/android-(\d+)/)?.[1] ?? 0);
      const bApi = Number(String(b?.["@_path"] ?? "").match(/android-(\d+)/)?.[1] ?? 0);
      if (bApi !== aApi) return bApi - aApi;
      return revisionScore(b.revision) - revisionScore(a.revision);
    });
  for (const pkg of packages) {
    const packagePath = String(pkg?.["@_path"] ?? "");
    const apiLevel = Number(packagePath.match(/android-(\d+)/)?.[1] ?? 0);
    const archives = asArray(pkg?.archives?.archive);
    const archive = archives.find((item: any) => {
      const os = text(item?.["host-os"]);
      const arch = text(item?.["host-arch"]);
      return (!os || os === hostOs()) && (!arch || arch === hostArch());
    }) ?? archives[0];
    const manifestBase = manifest.url.slice(0, manifest.url.lastIndexOf("/") + 1);
    const artifact = archiveToArtifact(archive, manifestBase, { packagePath, apiLevel, abi });
    if (artifact) return artifact;
  }
  throw new Error("No stable Google TV system image is currently published for " + abi + ".");
}
