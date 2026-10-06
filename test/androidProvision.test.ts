import { describe, expect, it } from "vitest";
import { guestProvisionCommands } from "../src/android/provision.js";

describe("Google TV guest provisioning", () => {
  it("marks Android TV setup complete without requiring a Google account", () => {
    const commands = guestProvisionCommands().map((item) => item.args.join(" "));

    expect(commands).toContain(
      "shell settings put global device_provisioned 1",
    );
    expect(commands).toContain(
      "shell settings put secure user_setup_complete 1",
    );
    expect(commands).toContain(
      "shell settings put secure tv_user_setup_complete 1",
    );
  });

  it("returns to the TV HOME launcher", () => {
    expect(
      guestProvisionCommands().some(
        (item) =>
          item.args.includes("android.intent.action.MAIN") &&
          item.args.includes("android.intent.category.HOME"),
      ),
    ).toBe(true);
  });
});
