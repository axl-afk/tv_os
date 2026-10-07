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
      "hw.lcd.width=1280",
      "hw.lcd.height=720",
      "hw.lcd.density=320",
      "hw.lcd.vsync=60",
      "hw.device.name=legacy_tv",
      "tag.id=google-tv",
      "",
    ].join("\n"),
  );

  return { root, configPath };
}

async function expectProfile(
  profile: "720p60" | "1080p60" | "4k60" | "native",
  expected: {
    width: number;
    height: number;
    density: number;
  },
) {
  const { root, configPath } = await createTestAvd();
  const { applyRuntimeGoogleTvProfile } =
    await import("../src/runtime/storage.js");

  applyRuntimeGoogleTvProfile(profile);

  const config = fs.readFileSync(configPath, "utf8");
  expect(config).toContain("PlayStore.enabled=true");
  expect(config).toContain("hw.device.manufacturer=Google");
  expect(config).toContain("hw.device.name=tv_4k");
  expect(config).toContain(`hw.lcd.width=${expected.width}`);
  expect(config).toContain(`hw.lcd.height=${expected.height}`);
  expect(config).toContain(`hw.lcd.density=${expected.density}`);
  expect(config).toContain("hw.lcd.vsync=60");
  expect(config).toContain("tag.display=Google TV");
  expect(config).toContain("tag.id=google-tv");

  fs.rmSync(root, { recursive: true, force: true });
}

describe("Google TV runtime profile", () => {
  it("configures 720p60 embedded output", async () => {
    await expectProfile("720p60", {
      width: 1280,
      height: 720,
      density: 320,
    });
  });

  it("configures 1080p60 embedded output", async () => {
    await expectProfile("1080p60", {
      width: 1920,
      height: 1080,
      density: 320,
    });
  });

  it("configures 4K60 embedded output", async () => {
    await expectProfile("4k60", {
      width: 3840,
      height: 2160,
      density: 640,
    });
  });

  it("uses a 4K60 framebuffer for direct/native mode", async () => {
    await expectProfile("native", {
      width: 3840,
      height: 2160,
      density: 640,
    });
  });
});
