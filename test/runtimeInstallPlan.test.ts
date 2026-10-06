import { describe, expect, it } from "vitest";
import { computeRuntimeInstallPlan } from "../src/runtime/installer.js";

describe("runtime incremental install plan", () => {
  const latest = {
    platformToolsUrl: "https://example/platform-tools.zip",
    emulatorUrl: "https://example/emulator.zip",
    systemImagePackage: "system-images;android-36;google-tv;arm64-v8a",
    apiLevel: 36,
    abi: "arm64-v8a",
  };

  it("reuses a complete current runtime without downloading components again", () => {
    expect(
      computeRuntimeInstallPlan({
        metadata: latest,
        latest,
        hasAdb: true,
        hasEmulator: true,
        hasSystemImage: true,
        hasAvd: true,
      }),
    ).toEqual({
      platformTools: false,
      emulator: false,
      systemImage: false,
      createAvd: false,
    });
  });

  it("downloads only a missing component", () => {
    expect(
      computeRuntimeInstallPlan({
        metadata: latest,
        latest,
        hasAdb: true,
        hasEmulator: false,
        hasSystemImage: true,
        hasAvd: true,
      }),
    ).toMatchObject({
      platformTools: false,
      emulator: true,
      systemImage: false,
    });
  });

  it("replaces the system image and AVD when the published image changes", () => {
    expect(
      computeRuntimeInstallPlan({
        metadata: { ...latest, apiLevel: 35, systemImagePackage: "system-images;android-35;google-tv;arm64-v8a" },
        latest,
        hasAdb: true,
        hasEmulator: true,
        hasSystemImage: false,
        hasAvd: true,
      }),
    ).toMatchObject({
      platformTools: false,
      emulator: false,
      systemImage: true,
      createAvd: true,
    });
  });

  it("reuses legacy installed tools when old metadata lacks component URLs", () => {
    expect(
      computeRuntimeInstallPlan({
        metadata: {
          emulatorUrl: latest.emulatorUrl,
          systemImagePackage: latest.systemImagePackage,
          apiLevel: latest.apiLevel,
          abi: latest.abi,
        },
        latest,
        hasAdb: true,
        hasEmulator: true,
        hasSystemImage: true,
        hasAvd: true,
      }),
    ).toMatchObject({
      platformTools: false,
      emulator: false,
      systemImage: false,
    });
  });
});
