import express from "express";
import cors from "cors";
import morgan from "morgan";
import { env, isDocumentAiConfigured } from "./config/env.js";
import { invoicesRouter } from "./routes/invoices.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { notificationsRouter } from "./routes/notifications.routes.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigins,
    })
  );
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      env: env.nodeEnv,
      documentAiConfigured: isDocumentAiConfigured(),
      time: new Date().toISOString(),
    });
  });

  app.use("/api/invoices", invoicesRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/notifications", notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
