import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { hashFile } from "../utils/hashFile.js";
import { resolveStoredFilePath } from "../utils/fileStorage.js";
import {
  listInvoices as storeList,
  getInvoiceById as storeGetById,
  findInvoiceByFileHash,
  insertInvoice,
} from "../utils/jsonStore.js";
import { logger } from "../utils/logger.js";
import { isDocumentAiConfigured } from "../config/env.js";

// Pipeline stage statuses for Phase 2 (pre-OCR). These are intentionally
// distinct from the business statuses the dashboard shows (valid / pending /
// duplicate / error) — those only exist once the validation engine (Phase 4)
// has actually run. Reporting one of *those* labels before real validation
// has happened would be exactly the "fake extraction result" the spec
// prohibits.
export const PIPELINE_STATUS = {
  UPLOADED: "UPLOADED", // file safely stored, not yet processed
  DUPLICATE_FILE: "DUPLICATE_FILE", // exact byte-for-byte duplicate of an existing upload
};

/**
 * Turns one Multer file object + its computed hash into a stored invoice
 * record, checking exact-file duplication as it goes.
 */
async function buildRecordFromUploadedFile(file) {
  const absolutePath = resolveStoredFilePath(file.filename);
  const fileHash = await hashFile(absolutePath);
  const existingMatch = findInvoiceByFileHash(fileHash);

  const now = new Date().toISOString();
  const record = {
    id: uuidv4(),
    // Kept only as display metadata — never used to build a filesystem path.
    originalFilename: file.originalname,
    storedFilename: file.filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    fileHash,
    status: existingMatch ? PIPELINE_STATUS.DUPLICATE_FILE : PIPELINE_STATUS.UPLOADED,
    isDuplicateFile: Boolean(existingMatch),
    duplicateOfId: existingMatch ? existingMatch.id : null,
    // Extraction/validation fields are intentionally absent until Phase 3/4
    // actually populate them — no placeholder invoice data here.
    extractedData: null,
    validation: null,
    uploadedAt: now,
    updatedAt: now,
    processingLogs: [
      {
        stage: "uploaded",
        status: "success",
        message: existingMatch
          ? `Stored, but matches an existing file byte-for-byte (invoice ${existingMatch.id}).`
          : "File received and stored on local disk.",
        timestamp: now,
      },
    ],
  };

  await insertInvoice(record);
  logger.info(`Invoice stored: ${record.id}`, {
    originalFilename: record.originalFilename,
    status: record.status,
  });
  return record;
}

export async function uploadSingleInvoice(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file received. Attach a file under the 'invoice' field." });
    }
    const record = await buildRecordFromUploadedFile(req.file);
    res.status(201).json({ invoice: record, documentAiConfigured: isDocumentAiConfigured() });
  } catch (err) {
    next(err);
  }
}

export async function uploadBulkInvoices(req, res, next) {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "No files received. Attach one or more files under the 'invoices' field." });
    }

    // Sequential on purpose for Phase 2 — keeps disk I/O and the JSON-store
    // write queue predictable. Swap for a BullMQ/Redis queue in Phase 3+
    // when OCR calls (which are slow and rate-limited) enter the picture.
    const results = [];
    const failures = [];
    for (const file of files) {
      try {
        const record = await buildRecordFromUploadedFile(file);
        results.push(record);
      } catch (err) {
        logger.error(`Failed to process uploaded file ${file.originalname}`, { message: err.message });
        failures.push({ originalFilename: file.originalname, error: err.message });
      }
    }

    res.status(201).json({
      uploaded: results.length,
      failed: failures.length,
      invoices: results,
      failures,
      documentAiConfigured: isDocumentAiConfigured(),
    });
  } catch (err) {
    next(err);
  }
}

export function getInvoices(req, res) {
  const { status, search } = req.query;
  let invoices = storeList();

  if (status) {
    invoices = invoices.filter((inv) => inv.status === status);
  }
  if (search) {
    const q = String(search).toLowerCase();
    invoices = invoices.filter(
      (inv) =>
        inv.originalFilename.toLowerCase().includes(q) ||
        inv.id.toLowerCase().includes(q)
    );
  }

  invoices = [...invoices].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  res.json({ count: invoices.length, invoices });
}

export function getInvoiceDetail(req, res) {
  const invoice = storeGetById(req.params.id);
  if (!invoice) {
    return res.status(404).json({ error: `Invoice ${req.params.id} not found` });
  }
  res.json({ invoice });
}

export function getDashboardStats(_req, res) {
  const invoices = storeList();
  const byStatus = invoices.reduce((acc, inv) => {
    acc[inv.status] = (acc[inv.status] || 0) + 1;
    return acc;
  }, {});

  res.json({
    total: invoices.length,
    uploaded: byStatus[PIPELINE_STATUS.UPLOADED] || 0,
    duplicateFiles: byStatus[PIPELINE_STATUS.DUPLICATE_FILE] || 0,
    totalBytesStored: invoices.reduce((s, inv) => s + (inv.sizeBytes || 0), 0),
    documentAiConfigured: isDocumentAiConfigured(),
    note: "Phase 2 stats — extraction/validation counts (valid/review/invalid) appear once Phase 3/4 are wired in.",
  });
}

// Lets a Phase-3 pipeline (or a manual retry) confirm the stored file still
// exists on disk before attempting to read it for OCR.
export function fileExistsForInvoice(invoice) {
  try {
    return fs.existsSync(resolveStoredFilePath(invoice.storedFilename));
  } catch {
    return false;
  }
}
