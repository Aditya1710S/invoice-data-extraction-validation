import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env.js";

const EXTENSION_BY_MIME = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
};

export function ensureUploadDirExists() {
  fs.mkdirSync(env.uploadDir, { recursive: true });
}

/**
 * Builds a safe, unpredictable filename for storage.
 * IMPORTANT: never uses the user-supplied filename for the actual stored
 * file/path — only the MIME type (validated by multer's fileFilter) decides
 * the extension. This is the defense against path traversal / injection via
 * malicious filenames like "../../etc/passwd" or "invoice.pdf\0.exe".
 */
export function buildStoredFilename(mimeType) {
  const ext = EXTENSION_BY_MIME[mimeType] || "";
  return `${uuidv4()}${ext}`;
}

/**
 * Resolves a stored filename to an absolute path, guaranteeing the result
 * stays inside the configured upload directory. Throws if it doesn't —
 * this is what stands between us and a path-traversal read/delete.
 */
export function resolveStoredFilePath(storedFilename) {
  const safeName = path.basename(storedFilename); // strips any directory component
  const resolved = path.resolve(env.uploadDir, safeName);
  if (!resolved.startsWith(env.uploadDir + path.sep) && resolved !== env.uploadDir) {
    throw new Error("Resolved path escapes the upload directory");
  }
  return resolved;
}
