import {
  discoverLatestEmulator,
  discoverLatestGoogleTvImage,
  platformToolsArtifact,
} from "./repository.js";

const [emulator, image] = await Promise.all([
  discoverLatestEmulator(),
  discoverLatestGoogleTvImage(),
]);

const platformTools = platformToolsArtifact();

if (!emulator.url.startsWith("https://dl.google.com/")) {
  throw new Error("Unexpected emulator download host.");
}
if (!platformTools.url.startsWith("https://dl.google.com/")) {
  throw new Error("Unexpected platform-tools download host.");
}
if (!image.url.startsWith("https://dl.google.com/")) {
  throw new Error("Unexpected Google TV image download host.");
}
if (!image.packagePath?.includes(";google-tv;")) {
  throw new Error("Repository probe did not resolve a Google TV image.");
}

console.log(JSON.stringify({
  host: { platform: process.platform, arch: process.arch },
  emulator: emulator.url,
  platformTools: platformTools.url,
  googleTv: {
    packagePath: image.packagePath,
    apiLevel: image.apiLevel,
    abi: image.abi,
    url: image.url,
  },
}, null, 2));
