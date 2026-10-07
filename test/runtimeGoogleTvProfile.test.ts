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

async function createTestAvd() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ultimate-tv-profile-"),
  );
  process.env.ULTIMATE_TV_RUNTIME_ROOT = root;

  const { runtimeAvdDir } = await import("../src/runtime/paths.js");
  const avdDir = runtimeAvdDir();
  fs.mkdirSync(avdDir, { recursive: true });

  const configPath = path.join(avdDir, "config.ini");
  fs.writeFileSync(
    configPath,
    [
      "PlayStore.enabled=true",
      "hw.lcd.width=1920",
      "hw.lcd.height=1080",
      "hw.lcd.density=320",
      "hw.lcd.vsync=60",
      "hw.device.name=legacy_tv",
      "tag.id=google-tv",
      "",
    ].join("\n"),
  );

  return { root, configPath };
}

describe("Google TV runtime profile", () => {
  it("configures native performance mode as a 4K 120 Hz TV", async () => {
    const { root, configPath } = await createTestAvd();
    const { applyRuntimeGoogleTvProfile } = await import("../src/runtime/storage.js");

    applyRuntimeGoogleTvProfile("native");

    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toContain("PlayStore.enabled=true");
    expect(config).toContain("hw.device.manufacturer=Google");
    expect(config).toContain("hw.device.name=tv_4k");
    expect(config).toContain("hw.initialOrientation=landscape");
    expect(config).toContain("hw.lcd.width=3840");
    expect(config).toContain("hw.lcd.height=2160");
    expect(config).toContain("hw.lcd.density=640");
    expect(config).toContain("hw.lcd.vsync=120");
    expect(config).toContain("tag.display=Google TV");
    expect(config).toContain("tag.id=google-tv");

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("configures embedded mode as a 720p 60 Hz framebuffer", async () => {
    const { root, configPath } = await createTestAvd();
    const { applyRuntimeGoogleTvProfile } = await import("../src/runtime/storage.js");

    applyRuntimeGoogleTvProfile("embedded");

    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toContain("hw.lcd.width=1280");
    expect(config).toContain("hw.lcd.height=720");
    expect(config).toContain("hw.lcd.density=320");
    expect(config).toContain("hw.lcd.vsync=60");

    fs.rmSync(root, { recursive: true, force: true });
  });
});
