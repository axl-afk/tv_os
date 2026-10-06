import { describe, expect, it } from "vitest";
import { parseDiscoveryIni } from "../src/emulator/discovery.js";

describe("emulator discovery parsing", () => {
  it("parses gRPC token and console-port fields without exposing assumptions", () => {
    const fields = parseDiscoveryIni([
      "port.serial=5554",
      "grpc.port=8554",
      "grpc.token=secret-value",
      "avd.name=Ultimate_TV_OS",
      "",
    ].join("\n"));

    expect(fields.get("port.serial")).toBe("5554");
    expect(fields.get("grpc.port")).toBe("8554");
    expect(fields.get("grpc.token")).toBe("secret-value");
  });
});
