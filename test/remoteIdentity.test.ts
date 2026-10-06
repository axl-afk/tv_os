import { describe, expect, it } from "vitest";
import { remoteAdvertisementIdentity } from "../src/remote/nativeProxy.js";

describe("native remote advertisement identity", () => {
  it("is stable for the same guest Android ID", () => {
    expect(remoteAdvertisementIdentity("abc123")).toBe(
      remoteAdvertisementIdentity("abc123"),
    );
  });

  it("changes when the guest identity changes", () => {
    expect(remoteAdvertisementIdentity("abc123")).not.toBe(
      remoteAdvertisementIdentity("def456"),
    );
  });

  it("uses a locally administered unicast MAC-style ID", () => {
    const value = remoteAdvertisementIdentity("abc123");
    expect(value).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    const first = Number.parseInt(value.slice(0, 2), 16);
    expect(first & 0x02).toBe(0x02);
    expect(first & 0x01).toBe(0);
  });
});
