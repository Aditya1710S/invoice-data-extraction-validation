import { logger } from "../utils/logger.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: `No route ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  console.error("\n❌ ==================== BACKEND ERROR TRACE ====================");
  console.error(`❌ Invoice Processing Error [Stage: ${err.stage || "unknown"}]:`, err.message || err);
  if (err.code) console.error("❌ Error Code:", err.code);
  if (err.stack) console.error("❌ Stack Trace:\n", err.stack);
  console.error("===============================================================\n");

  logger.error("Unhandled API Error", { message: err.message, stack: err.stack, code: err.code, stage: err.stage });

  res.status(status).json({
    success: false,
    error: err.message || "Invoice processing failed",
    stage: err.stage || "processing",
  });
}
