import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import selfsigned from "selfsigned";

export type CertificatePair = { key: string; cert: string };

export async function loadOrCreateCertificate(): Promise<CertificatePair> {
  const dir = path.join(os.homedir(), ".ultimate-tv");
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
