import "dotenv/config";
import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import os from "os";

let port = env.PORT;

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const nets of Object.values(interfaces)) {
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
};

const server = app.listen(port);

server.on("listening", () => {
  const ip = getLocalIP();
  console.log(`  Local:   http://localhost:${port}`);
  console.log(`  Network: http://${ip}:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    const previousPort = port;
    port += 1;
    console.warn(`Port ${previousPort} is already in use; trying ${port}`);
    server.listen(port);
    return;
  }

  console.error("Unable to start the server:", error);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.info(`${signal} received; shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
