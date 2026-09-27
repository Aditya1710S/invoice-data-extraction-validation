import { createApp } from "./app.js";
import { env, isDocumentAiConfigured } from "./config/env.js";
import { initDatabase } from "./config/db.js";
import { logger } from "./utils/logger.js";

async function start() {
  try {
    await initDatabase();
    const app = createApp();

    app.listen(env.port, () => {
      logger.info(`InvoiceFlow backend listening on http://localhost:${env.port}`);
      logger.info(`CORS allowed origins: ${env.corsOrigins.join(", ")}`);
      logger.info("Connected to MySQL Database: invoiceflow");
      if (!isDocumentAiConfigured()) {
        logger.warn(
          "Google Document AI is not configured. Intelligent fallback parser is active."
        );
      }
    });
  } catch (err) {
    logger.error("Failed to start backend server:", err);
    process.exit(1);
  }
}

start();
