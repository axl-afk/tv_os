import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import selfsigned from "selfsigned";

export type CertificatePair = { key: string; cert: string };

export type RsaKeyParts = {
  modulus: Buffer;
  exponent: Buffer;
};

function stateRoot(override?: string): string {
  return override ?? process.env.ULTIMATE_TV_HOME ?? path.join(os.homedir(), ".ultimate-tv");
}

export async function loadOrCreateCertificate(stateDir?: string): Promise<CertificatePair> {
  const dir = stateRoot(stateDir);
  const keyPath = path.join(dir, "remote-key.pem");
  const certPath = path.join(dir, "remote-cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath, "utf8"),
      cert: fs.readFileSync(certPath, "utf8"),
    };
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);

  const generated = await selfsigned.generate(
    [{ name: "commonName", value: "Ultimate TV OS" }],
    {
      keySize: 2048,
      algorithm: "sha256",
      notAfterDate,
    },
  );

  fs.writeFileSync(keyPath, generated.private, { mode: 0o600 });
  fs.writeFileSync(certPath, generated.cert, { mode: 0o600 });

  return { key: generated.private, cert: generated.cert };
}

export function rawCertificateFromPem(pem: string): Buffer {
  return new crypto.X509Certificate(pem).raw;
}

export function rsaKeyPartsFromRawCertificate(raw: Buffer): RsaKeyParts {
  const certificate = new crypto.X509Certificate(raw);
  const jwk = certificate.publicKey.export({ format: "jwk" });

  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new Error("Android TV Remote v2 pairing requires an RSA certificate.");
  }

  return {
    modulus: Buffer.from(jwk.n, "base64url"),
    exponent: Buffer.from(jwk.e, "base64url"),
  };
}

export function pairingDigest(
  clientCertificateRaw: Buffer,
  serverCertificateRaw: Buffer,
  nonce: Buffer,
): Buffer {
  const client = rsaKeyPartsFromRawCertificate(clientCertificateRaw);
  const server = rsaKeyPartsFromRawCertificate(serverCertificateRaw);

  return crypto
    .createHash("sha256")
    .update(client.modulus)
    .update(client.exponent)
    .update(server.modulus)
    .update(server.exponent)
    .update(nonce)
    .digest();
}

export function certificateFingerprint(raw: Buffer): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function pairedPath(stateDir?: string): string {
  return path.join(stateRoot(stateDir), "paired-clients.json");
}

export function loadPairedFingerprints(stateDir?: string): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(pairedPath(stateDir), "utf8")) as {
      sha256?: unknown;
    };
    if (!Array.isArray(parsed.sha256)) return new Set();
    return new Set(parsed.sha256.filter((item): item is string => typeof item === "string"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    if (error instanceof SyntaxError) return new Set();
    throw error;
  }
}

export function savePairedFingerprints(
  fingerprints: Set<string>,
  stateDir?: string,
): void {
  const dir = stateRoot(stateDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destination = pairedPath(stateDir);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(
    temporary,
    `${JSON.stringify({ sha256: [...fingerprints].sort() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.renameSync(temporary, destination);
}

export function clearPairedFingerprints(stateDir?: string): boolean {
  try {
    fs.unlinkSync(pairedPath(stateDir));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
