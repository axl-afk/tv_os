import protobuf from "protobufjs";

const pairingSchema = `
syntax = "proto3";
package pairing;

enum RoleType {
  ROLE_TYPE_UNKNOWN = 0;
  ROLE_TYPE_INPUT = 1;
  ROLE_TYPE_OUTPUT = 2;
}
message PairingRequest { string service_name = 1; string client_name = 2; }
message PairingRequestAck { string server_name = 1; }
message PairingEncoding {
  enum EncodingType {
    ENCODING_TYPE_UNKNOWN = 0;
    ENCODING_TYPE_ALPHANUMERIC = 1;
    ENCODING_TYPE_NUMERIC = 2;
    ENCODING_TYPE_HEXADECIMAL = 3;
    ENCODING_TYPE_QRCODE = 4;
  }
  EncodingType type = 1;
  uint32 symbol_length = 2;
}
message PairingOption {
  repeated PairingEncoding input_encodings = 1;
  repeated PairingEncoding output_encodings = 2;
  RoleType preferred_role = 3;
}
message PairingConfiguration {
  PairingEncoding encoding = 1;
  RoleType client_role = 2;
}
message PairingConfigurationAck {}
message PairingSecret { bytes secret = 1; }
message PairingSecretAck { bytes secret = 1; }
message PairingMessage {
  enum Status {
    UNKNOWN = 0;
    STATUS_OK = 200;
    STATUS_ERROR = 400;
    STATUS_BAD_CONFIGURATION = 401;
    STATUS_BAD_SECRET = 402;
  }
  int32 protocol_version = 1;
  Status status = 2;
  int32 request_case = 3;
  PairingRequest pairing_request = 10;
  PairingRequestAck pairing_request_ack = 11;
  PairingOption pairing_option = 20;
  PairingConfiguration pairing_configuration = 30;
  PairingConfigurationAck pairing_configuration_ack = 31;
  PairingSecret pairing_secret = 40;
  PairingSecretAck pairing_secret_ack = 41;
}
`;

const remoteSchema = `
syntax = "proto3";
package remote;

message RemoteAppLinkLaunchRequest { string app_link = 1; }
message RemoteStart { bool started = 1; }
message RemoteVoiceBegin { int32 session_id = 1; string package_name = 2; }
message RemoteVoicePayload { int32 session_id = 1; bytes samples = 2; }
message RemoteVoiceEnd { int32 session_id = 1; }
message RemoteTextFieldStatus {
  int32 counter_field = 1;
  string value = 2;
  int32 start = 3;
  int32 end = 4;
  int32 int5 = 5;
  string label = 6;
}
message RemoteImeObject { int32 start = 1; int32 end = 2; string value = 3; }
message RemoteEditInfo { int32 insert = 1; RemoteImeObject text_field_status = 2; }
message RemoteImeBatchEdit {
  int32 ime_counter = 1;
  int32 field_counter = 2;
  repeated RemoteEditInfo edit_info = 3;
}
message RemoteAppInfo {
  int32 counter = 1;
  int32 int2 = 2;
  int32 int3 = 3;
  string int4 = 4;
  int32 int7 = 7;
  int32 int8 = 8;
  string label = 10;
  string app_package = 12;
  int32 int13 = 13;
}
message RemoteImeKeyInject {
  RemoteAppInfo app_info = 1;
  RemoteTextFieldStatus text_field_status = 2;
}
message RemoteDeviceInfo {
  string model = 1;
  string vendor = 2;
  int32 unknown1 = 3;
  string unknown2 = 4;
  string package_name = 5;
  string app_version = 6;
}
message RemoteConfigure { int32 code1 = 1; RemoteDeviceInfo device_info = 2; }
message RemoteSetActive { int32 active = 1; }
message RemotePingRequest { int32 val1 = 1; int32 val2 = 2; }
message RemotePingResponse { int32 val1 = 1; }
message RemoteKeyInject { int32 key_code = 1; int32 direction = 2; }
message RemoteMessage {
  RemoteConfigure remote_configure = 1;
  RemoteSetActive remote_set_active = 2;
  RemotePingRequest remote_ping_request = 8;
  RemotePingResponse remote_ping_response = 9;
  RemoteKeyInject remote_key_inject = 10;
  RemoteImeKeyInject remote_ime_key_inject = 20;
  RemoteImeBatchEdit remote_ime_batch_edit = 21;
  RemoteVoiceBegin remote_voice_begin = 30;
  RemoteVoicePayload remote_voice_payload = 31;
  RemoteVoiceEnd remote_voice_end = 32;
  RemoteStart remote_start = 40;
  RemoteAppLinkLaunchRequest remote_app_link_launch_request = 90;
}
`;

function rootFrom(schema: string) {
  return protobuf.parse(schema, { keepCase: false }).root;
}

const pairingRoot = rootFrom(pairingSchema);
const remoteRoot = rootFrom(remoteSchema);

export const PairingMessage = pairingRoot.lookupType("pairing.PairingMessage");
export const RemoteMessage = remoteRoot.lookupType("remote.RemoteMessage");

export const RemoteFeature = {
  PING: 2 ** 0,
  KEY: 2 ** 1,
  IME: 2 ** 2,
  VOICE: 2 ** 3,
  UNKNOWN_1: 2 ** 4,
  POWER: 2 ** 5,
  VOLUME: 2 ** 6,
  APP_LINK: 2 ** 9,
} as const;

// v0.1 deliberately does not advertise VOICE until microphone audio can be
// delivered into the guest through a protected, low-latency path.
export const HOST_REMOTE_FEATURES =
  RemoteFeature.PING |
  RemoteFeature.KEY |
  RemoteFeature.IME |
  RemoteFeature.POWER |
  RemoteFeature.VOLUME |
  RemoteFeature.APP_LINK;

export function encodeDelimited(type: protobuf.Type, payload: object): Buffer {
  const error = type.verify(payload);
  if (error) throw new Error(error);
  return Buffer.from(type.encodeDelimited(type.create(payload)).finish());
}

export function decodeFrames(
  type: protobuf.Type,
  input: Buffer,
): { messages: protobuf.Message[]; rest: Buffer } {
  const messages: protobuf.Message[] = [];
  let offset = 0;

  while (offset < input.length) {
    const reader = protobuf.Reader.create(input.subarray(offset));
    let size: number;
    try {
      size = reader.uint32();
    } catch {
      break;
    }

    const prefixBytes = reader.pos;
    if (input.length - offset - prefixBytes < size) break;

    const payload = input.subarray(offset + prefixBytes, offset + prefixBytes + size);
    messages.push(type.decode(payload));
    offset += prefixBytes + size;
  }

  return { messages, rest: input.subarray(offset) };
}
