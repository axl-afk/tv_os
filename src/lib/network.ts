import net from "node:net";

export async function reserveFreeLoopbackPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port =
    address && typeof address === "object" ? address.port : 0;

  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (!port) throw new Error("Unable to reserve a local TCP port.");
  return port;
}
