import { describe, expect, it } from "vitest";
import { buildAdbSwipeArgs } from "../src/android/adbInput.js";

describe("ADB swipe input", () => {
  it("builds a real Android swipe command", () => {
    expect(buildAdbSwipeArgs(10.4, 20.6, 300.2, 400.8, 275)).toEqual([
      "shell",
      "input",
      "swipe",
      "10",
      "21",
      "300",
      "401",
      "275",
    ]);
  });

  it("clamps unsafe swipe durations", () => {
    expect(buildAdbSwipeArgs(0, 0, 100, 100, 1).at(-1)).toBe("50");
    expect(buildAdbSwipeArgs(0, 0, 100, 100, 9999).at(-1)).toBe("2000");
  });
});
