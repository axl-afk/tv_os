import { describe, expect, it } from "vitest";
import { encodeAdbInputText } from "../src/android/adbInput.js";

describe("ADB TV text input", () => {
  it("encodes spaces for Android input text", () => {
    expect(encodeAdbInputText("hello world")).toBe("hello%sworld");
  });

  it("escapes common shell metacharacters", () => {
    expect(encodeAdbInputText("a&b$c!")).toBe("a\\&b\\$c\\!");
  });

  it("leaves email addresses and dots intact", () => {
    expect(encodeAdbInputText("user@example.com")).toBe("user@example.com");
  });
});
