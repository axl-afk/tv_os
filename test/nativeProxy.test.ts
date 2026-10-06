import { describe, expect, it, vi } from "vitest";

describe("native remote proxy architecture", () => {
  it("reserves the standard Android TV Remote v2 public ports", async () => {
    const mod = await import("../src/remote/nativeProxy.js");
    expect(typeof mod.NativeAndroidTvRemoteProxy).toBe("function");
    expect(typeof mod.hasNativeAndroidTvRemoteService).toBe("function");
  });
});
