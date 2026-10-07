import { describe, expect, it } from "vitest";
import {
  compatibilityTvConfigurePayload,
  shouldInjectRemoteKey,
} from "../src/remote/server.js";

describe("phone remote tap handling", () => {
  it("injects a normal short DPAD-center tap", () => {
    expect(shouldInjectRemoteKey(23, 3)).toBe(true);
  });

  it("injects DPAD-center immediately when a client starts a long press", () => {
    expect(shouldInjectRemoteKey(23, 1)).toBe(true);
  });

  it("does not duplicate an END_LONG event", () => {
    expect(shouldInjectRemoteKey(23, 2)).toBe(false);
  });

  it("advertises key support in the active feature mask", () => {
    expect(compatibilityTvConfigurePayload().code1).toBeGreaterThan(0);
  });
});
