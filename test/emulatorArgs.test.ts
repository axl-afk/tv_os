import { describe, expect, it } from "vitest";
import { buildEmulatorArgs } from "../src/android/emulator.js";

describe("embedded emulator launch security", () => {
  it("enables emulator token authentication for the private gRPC endpoint", () => {
    const args = buildEmulatorArgs({
      avd: "Ultimate_TV_OS",
      headless: true,
      grpcPort: 43210,
    });

    const grpcIndex = args.indexOf("-grpc");
    expect(grpcIndex).toBeGreaterThanOrEqual(0);
    expect(args[grpcIndex + 1]).toBe("43210");
    expect(args).toContain("-grpc-use-token");
  });

  it("keeps gRPC disabled when no embedded endpoint is requested", () => {
    const args = buildEmulatorArgs({ avd: "Ultimate_TV_OS" });
    expect(args).not.toContain("-grpc");
    expect(args).not.toContain("-grpc-use-token");
  });
});
