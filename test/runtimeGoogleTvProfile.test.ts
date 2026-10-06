import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const originalRoot = process.env.ULTIMATE_TV_RUNTIME_ROOT;

afterEach(() => {
  if (originalRoot === undefined) {
    delete process.env.ULTIMATE_TV_RUNTIME_ROOT;
  } else {
    process.env.ULTIMATE_TV_RUNTIME_ROOT = originalRoot;
  }
});

describe("Google TV runtime profile", () => {
  it("repairs an existing AVD into the Google TV 4K hardware profile", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ultimate-tv-profile-"));
    process.env.ULTIMATE_TV_RUNTIME_ROOT = root;

    const { runtimeAvdDir } = await import("../src/runtime/paths.js");
    const { applyRuntimeGoogleTvProfile } = await import("../src/runtime/storage.js");

    const avdDir = runtimeAvdDir();
    fs.mkdirSync(avdDir, { recursive: true });
    const configPath = path.join(avdDir, "config.ini");

    fs.writeFileSync(
      configPath,
      [
        "PlayStore.enabled=true",
        "hw.lcd.density=320",
        "hw.device.name=legacy_tv",
        "tag.id=google-tv",
        "",
      ].join("\n"),
    );

    applyRuntimeGoogleTvProfile();

    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toContain("PlayStore.enabled=true");
    expect(config).toContain("hw.device.manufacturer=Google");
    expect(config).toContain("hw.device.name=tv_4k");
    expect(config).toContain("hw.initialOrientation=landscape");
    expect(config).toContain("hw.lcd.density=640");
    expect(config).toContain("tag.display=Google TV");
    expect(config).toContain("tag.id=google-tv");

    fs.rmSync(root, { recursive: true, force: true });
  });
});
