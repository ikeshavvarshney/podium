import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express, Router } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { attachUser } from "./middleware/auth.js";
import { buildOpenApi } from "./lib/openapi.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import authRoutes from "./routes/auth.routes.js";
import eventRoutes from "./routes/event.routes.js";
import inviteRoutes from "./routes/invite.routes.js";
import organizerRoutes from "./routes/organizer.routes.js";
import recordRoutes from "./routes/record.routes.js";
import statsRoutes from "./routes/stats.routes.js";

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    }),
  );
  // An event export can run to megabytes; everything else stays small.
  const bigJson = express.json({ limit: "50mb" });
  const smallJson = express.json({ limit: "1mb" });
  app.use((req, res, next) => (req.path === "/api/events/import" ? bigJson : smallJson)(req, res, next));
  app.use(cookieParser());
  app.use(attachUser);

  const api = Router();

  api.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "up" });
    } catch {
      res.status(503).json({ status: "degraded", database: "down" });
    }
  });

  api.use("/auth", authRoutes);
  api.use("/events", eventRoutes);
  api.use("/stats", statsRoutes);
  api.use("/invites", inviteRoutes);
  api.use("/organizer", organizerRoutes);
  api.use("/records", recordRoutes);

  let spec: ReturnType<typeof buildOpenApi> | null = null;
  api.get("/openapi.json", (_req, res) => {
    spec ??= buildOpenApi(app);
    res.json(spec);
  });

  app.use("/api", api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
