import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

/**
 * A single Prisma client for the process. Re-used across hot reloads in
 * development so `tsx watch` does not exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isProduction ? ["warn", "error"] : ["warn", "error"],
  });

if (!config.isProduction) globalForPrisma.prisma = prisma;
