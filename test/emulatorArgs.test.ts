import { describe, expect, it } from "vitest";
import { buildEmulatorArgs } from "../src/android/emulator.js";

describe("embedded emulator launch security", () => {
  it("binds gRPC to localhost instead of exposing a bare port", () => {
    const args = buildEmulatorArgs({
      avd: "Ultimate_TV_OS",
      headless: true,
      grpcPort: 43210,
    });

    const grpcIndex = args.indexOf("-grpc");
    expect(grpcIndex).toBeGreaterThanOrEqual(0);
    expect(args[grpcIndex + 1]).toBe("localhost:43210");
    expect(args).not.toContain("43210");
  });

  it("keeps gRPC disabled when no embedded endpoint is requested", () => {
    const args = buildEmulatorArgs({ avd: "Ultimate_TV_OS" });
    expect(args).not.toContain("-grpc");
  });
});
