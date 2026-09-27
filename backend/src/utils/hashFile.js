import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Streams a file off disk and returns its SHA-256 hex digest.
 * Used for exact-file duplicate detection (requirement: detect duplicate
 * invoices via file hash, independent of OCR/extraction).
 */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
