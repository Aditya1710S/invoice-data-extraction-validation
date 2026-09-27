import "dotenv/config";
import path from "node:path";

const rootDir = path.resolve(process.cwd());

function parseList(value, fallback) {
  if (!value) return fallback;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

const rawCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./credentials/invoiceflow-service-account.json";
const resolvedCredPath = path.isAbsolute(rawCredPath) ? rawCredPath : path.resolve(rootDir, rawCredPath);

if (resolvedCredPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedCredPath;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 4000,
  corsOrigins: parseList(process.env.CORS_ORIGIN, ["http://localhost:5173"]),

  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || "src/uploads"),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 20,
  allowedMimeTypes: parseList(process.env.ALLOWED_MIME_TYPES, [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/jpg",
  ]),

  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || "invoiceflow",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "1234",
  },
  documentAi: {
    credentialsPath: resolvedCredPath,
    projectId: process.env.GCP_PROJECT_ID || "iconic-rampart-507904-c5",
    location: process.env.GCP_LOCATION || "us",
    processorId: process.env.DOCUMENT_AI_PROCESSOR_ID || "476e71c960ba484b",
  },
  currency: {
    baseCurrency: (process.env.BASE_CURRENCY || "USD").toUpperCase(),
    provider: process.env.EXCHANGE_RATE_PROVIDER || "exchangerate.host",
    apiKey: process.env.EXCHANGE_RATE_API_KEY || "",
  },
  bulk: {
    batchSize: Number(process.env.BULK_BATCH_SIZE) || 10,
    maxRetries: Number(process.env.MAX_RETRIES) || 2,
    maxFiles: Number(process.env.BULK_MAX_FILES) || 1000,
  },
};


export function isDocumentAiConfigured() {
  const { credentialsPath, projectId, processorId } = env.documentAi;
  return Boolean(credentialsPath && projectId && processorId);
}
