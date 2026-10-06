import { describe, expect, it } from "vitest";
import { AndroidKeyCode } from "../src/android/adbInput.js";

describe("Android TV emulator select workaround", () => {
  it("maps DPAD_CENTER to ENTER in host compatibility mode", () => {
    expect(AndroidKeyCode[23]).toBe(66);
  });
});
