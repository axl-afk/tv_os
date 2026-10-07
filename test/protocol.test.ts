import { describe, expect, it } from "vitest";
import {
  PairingMessage,
  RemoteMessage,
  decodeFrames,
  encodeDelimited,
} from "../src/remote/protocol.js";
import {
  compatibilitySetActivePayload,
  shouldInjectRemoteKey,
} from "../src/remote/server.js";

describe("remote compatibility behavior", () => {
  it("keeps the swipe-working empty activation handshake", () => {
    expect(compatibilitySetActivePayload()).toEqual({});
  });

  it("keeps short swipes/presses and fixes DPAD_CENTER tap start", () => {
    expect(shouldInjectRemoteKey(19, 3)).toBe(true);
    expect(shouldInjectRemoteKey(23, 1)).toBe(true);
    expect(shouldInjectRemoteKey(19, 1)).toBe(false);
  });
});

describe("remote protocol framing", () => {
  it("round trips a pairing frame", () => {
    const frame = encodeDelimited(PairingMessage, {
      protocolVersion: 2,
      status: 200,
      pairingRequestAck: { serverName: "Ultimate TV OS" },
    });

    const decoded = decodeFrames(PairingMessage, frame);
    expect(decoded.rest.length).toBe(0);
    expect(decoded.messages).toHaveLength(1);

    const object = PairingMessage.toObject(decoded.messages[0]) as any;
    expect(object.protocolVersion).toBe(2);
    expect(object.status).toBe(200);
    expect(object.pairingRequestAck.serverName).toBe("Ultimate TV OS");
  });

  it("keeps an incomplete frame buffered", () => {
    const frame = encodeDelimited(RemoteMessage, {
      remotePingRequest: { val1: 7 },
    });
    const first = frame.subarray(0, frame.length - 1);

    const decoded = decodeFrames(RemoteMessage, first);
    expect(decoded.messages).toHaveLength(0);
    expect(decoded.rest.length).toBe(first.length);
  });
});
