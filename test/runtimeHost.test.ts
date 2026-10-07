import { describe, expect, it } from "vitest";
import {
  resolveRuntimeHostArch,
  runtimeHostSupport,
} from "../src/runtime/host.js";

describe("runtime host architecture", () => {
  it("uses native Apple Silicon hardware even when Electron is translated", () => {
    expect(resolveRuntimeHostArch("darwin", "x64", true)).toBe("arm64");
    it("supports native Apple Silicon and x64 desktop hosts", () => {
    expect(runtimeHostSupport("darwin", "arm64").supported).toBe(true);
    expect(runtimeHostSupport("darwin", "x64").supported).toBe(true);
    expect(runtimeHostSupport("win32", "x64").supported).toBe(true);
    expect(runtimeHostSupport("linux", "x64").supported).toBe(true);
  });

  it("refuses unsupported Windows ARM and Linux ARM hosts", () => {
    expect(runtimeHostSupport("win32", "arm64").supported).toBe(false);
    expect(runtimeHostSupport("linux", "arm64").supported).toBe(false);
  });
});

  it("keeps Intel Macs on x64", () => {
    expect(resolveRuntimeHostArch("darwin", "x64", false)).toBe("x64");
  });

  it("detects Windows ARM hardware even when the app process is x64", () => {
    expect(resolveRuntimeHostArch("win32", "x64", false, true)).toBe("arm64");
  });

  it("uses the process architecture on supported non-translated hosts", () => {
    expect(resolveRuntimeHostArch("linux", "arm64", false, false)).toBe("arm64");
    expect(resolveRuntimeHostArch("win32", "x64", false, false)).toBe("x64");
  });
});
