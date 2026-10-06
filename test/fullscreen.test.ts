import { describe, expect, it } from "vitest";
import { requestEmulatorFullscreen } from "../src/host/fullscreen.js";

describe("fullscreen host helper", () => {
  it("exposes a cross-platform fullscreen request API", () => {
    expect(typeof requestEmulatorFullscreen).toBe("function");
  });
});
