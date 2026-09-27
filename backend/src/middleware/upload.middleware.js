import multer from "multer";
import { env } from "../config/env.js";
import { ensureUploadDirExists, buildStoredFilename } from "../utils/fileStorage.js";

ensureUploadDirExists();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    // Never trust file.originalname for the on-disk name — see fileStorage.js.
    cb(null, buildStoredFilename(file.mimetype));
  },
});

function fileFilter(_req, file, cb) {
  if (!env.allowedMimeTypes.includes(file.mimetype)) {
    const err = new Error(
      `Unsupported file type "${file.mimetype}". Allowed: ${env.allowedMimeTypes.join(", ")}`
    );
    err.status = 400;
    cb(err);
    return;
  }
  cb(null, true);
}

const limits = {
  fileSize: env.maxFileSizeMb * 1024 * 1024,
  files: 50, // sane ceiling for a bulk upload batch
};

const multerInstance = multer({ storage, fileFilter, limits });

export const uploadSingle = multerInstance.single("invoice");
export const uploadMultiple = multerInstance.array("invoices", 50);

/**
 * Normalizes Multer's errors (wrong field name, file too large, too many
 * files, rejected type) into the same JSON error shape as the rest of the API.
 */
export function handleUploadErrors(err, _req, res, next) {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `File exceeds the ${env.maxFileSizeMb}MB limit.`,
      LIMIT_FILE_COUNT: "Too many files in one batch (max 50).",
      LIMIT_UNEXPECTED_FILE: "Unexpected file field in the request.",
    };
    return res.status(400).json({
      error: messages[err.code] || err.message,
      code: err.code,
    });
  }
  if (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  next();
}
