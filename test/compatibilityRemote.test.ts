import { describe, expect, it } from "vitest";
import {
  compatibilityPairingOptionPayload,
  compatibilityTvConfigurePayload,
} from "../src/remote/server.js";

describe("Ultimate TV Remote v2 server identity", () => {
  it("asks the phone to use the input role and a six-digit hex code", () => {
    expect(compatibilityPairingOptionPayload()).toEqual({
      preferredRole: 1,
      outputEncodings: [{ type: 3, symbolLength: 6 }],
    });
  });

  it("speaks first as an Android TV Remote Service endpoint", () => {
    const payload = compatibilityTvConfigurePayload();

    expect(payload.code1).toBe(639);
    expect(payload.deviceInfo.packageName).toBe(
      "com.google.android.tv.remote.service",
    );
    expect(payload.deviceInfo.model).toBe("Ultimate TV OS");
    expect(payload.deviceInfo.unknown1).toBe(1);
  });
});
