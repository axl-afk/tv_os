import { describe, expect, it } from "vitest";
import { resolveRuntimeHostArch } from "../src/runtime/host.js";

describe("runtime host architecture", () => {
  it("uses native Apple Silicon hardware even when Electron is translated", () => {
    expect(resolveRuntimeHostArch("darwin", "x64", true)).toBe("arm64");
  });

  it("keeps Intel Macs on x64", () => {
    expect(resolveRuntimeHostArch("darwin", "x64", false)).toBe("x64");
  });

  it("uses the process architecture on non-macOS hosts", () => {
    expect(resolveRuntimeHostArch("linux", "arm64", false)).toBe("arm64");
    expect(resolveRuntimeHostArch("win32", "x64", false)).toBe("x64");
  });
});
