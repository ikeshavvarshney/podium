import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`[podium] API listening on http://localhost:${config.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[podium] ${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
