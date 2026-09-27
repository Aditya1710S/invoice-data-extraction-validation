/**
 * Bulk Invoice Processing Queue Service
 * Non-blocking background queue with controlled concurrency, retry logic,
 * and live batch progress tracking in MySQL.
 */

import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

// In-memory batch registry (survives within a single server process)
const activeBatches = new Map();

/**
 * Creates a new batch record in MySQL and returns the batchId.
 */
export async function createBatchInMysql(totalInvoices) {
  const batchId = `BATCH-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

  await pool.query(
    `INSERT INTO invoice_batches
       (batch_id, total_invoices, processed_invoices, valid_count, invalid_count,
        review_count, failed_count, duplicate_count, status, created_at)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0, 'PROCESSING', NOW())`,
    [batchId, totalInvoices]
  );

  activeBatches.set(batchId, {
    total: totalInvoices,
    processed: 0,
    valid: 0,
    invalid: 0,
    review: 0,
    failed: 0,
    duplicate: 0,
    status: "PROCESSING",
    results: [],
    cancelled: false,
  });

  logger.info(`[BULK] Created batch ${batchId} for ${totalInvoices} invoices`);
  return batchId;
}

/**
 * Returns the current batch status from in-memory registry (fast) or MySQL (fallback).
 */
export async function getBatchStatus(batchId) {
  // First try in-memory (faster, available during processing)
  const mem = activeBatches.get(batchId);
  if (mem) {
    return {
      batchId,
      status: mem.cancelled ? "CANCELLED" : mem.status,
      total: mem.total,
      processed: mem.processed,
      valid: mem.valid,
      invalid: mem.invalid,
      review: mem.review,
      failed: mem.failed,
      duplicate: mem.duplicate,
      results: mem.results,
      progress: mem.total > 0 ? Math.round((mem.processed / mem.total) * 100) : 0,
    };
  }

  // Fall back to MySQL for completed/persisted batches
  const [rows] = await pool.query(
    "SELECT * FROM invoice_batches WHERE batch_id = ?",
    [batchId]
  );

  if (!rows.length) return null;

  const row = rows[0];
  const [invoiceRows] = await pool.query(
    "SELECT invoice_id, invoice_number, vendor_name, grand_total, validation_status, currency_code FROM invoices WHERE batch_id = ? ORDER BY created_at ASC",
    [batchId]
  );

  return {
    batchId: row.batch_id,
    status: row.status,
    total: row.total_invoices,
    processed: row.processed_invoices,
    valid: row.valid_count,
    invalid: row.invalid_count,
    review: row.review_count,
    failed: row.failed_count,
    duplicate: row.duplicate_count,
    results: invoiceRows.map((r) => ({
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      vendorName: r.vendor_name,
      grandTotal: Number(r.grand_total),
      status: r.validation_status,
      currencyCode: r.currency_code,
    })),
    progress: row.total_invoices > 0
      ? Math.round((row.processed_invoices / row.total_invoices) * 100)
      : 100,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * Cancel a running batch.
 */
export async function cancelBatch(batchId) {
  const mem = activeBatches.get(batchId);
  if (mem) {
    mem.cancelled = true;
  }
  await pool.query(
    "UPDATE invoice_batches SET status = 'CANCELLED' WHERE batch_id = ? AND status = 'PROCESSING'",
    [batchId]
  );
  logger.info(`[BULK] Batch ${batchId} cancellation requested`);
  return true;
}

/**
 * Increment batch counters in MySQL (called after each file is processed).
 */
async function incrementBatchCounters(batchId, outcome) {
  const mem = activeBatches.get(batchId);
  if (mem) {
    mem.processed++;
    if (outcome === "VALID") mem.valid++;
    else if (outcome === "INVALID") mem.invalid++;
    else if (outcome === "NEEDS_REVIEW" || outcome === "PENDING") mem.review++;
    else if (outcome === "DUPLICATE") mem.duplicate++;
    else mem.failed++;
  }

  const countField = {
    VALID: "valid_count",
    INVALID: "invalid_count",
    NEEDS_REVIEW: "review_count",
    PENDING: "review_count",
    DUPLICATE: "duplicate_count",
  }[outcome] || "failed_count";

  await pool.query(
    `UPDATE invoice_batches
     SET processed_invoices = processed_invoices + 1,
         ${countField} = ${countField} + 1
     WHERE batch_id = ?`,
    [batchId]
  );
}

/**
 * Marks a batch as completed in MySQL.
 */
async function completeBatch(batchId) {
  const mem = activeBatches.get(batchId);
  if (mem && !mem.cancelled) {
    mem.status = "COMPLETED";
  }

  await pool.query(
    `UPDATE invoice_batches
     SET status = CASE WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE 'COMPLETED' END,
         completed_at = NOW()
     WHERE batch_id = ?`,
    [batchId]
  );

  logger.info(`[BULK] Batch ${batchId} completed.`);
  // Clean up in-memory after 30 minutes
  setTimeout(() => activeBatches.delete(batchId), 30 * 60 * 1000);
}

/**
 * Runs the bulk processing queue in the background.
 * Uses controlled concurrency (BULK_BATCH_SIZE at a time).
 * Each file is independently retried up to MAX_RETRIES times.
 *
 * @param {string} batchId
 * @param {Array} files - array of multer file objects
 * @param {Function} processFn - async function(file, batchId) → record
 */
export async function runBulkQueue(batchId, files, processFn) {
  const concurrency = env.bulk?.batchSize || 10;
  const maxRetries = env.bulk?.maxRetries || 2;

  logger.info(`[BULK] Starting batch ${batchId}: ${files.length} files, concurrency=${concurrency}, maxRetries=${maxRetries}`);

  let fileIndex = 0;

  async function processNext() {
    const mem = activeBatches.get(batchId);
    if (!mem || mem.cancelled) return;
    if (fileIndex >= files.length) return;

    const file = files[fileIndex++];
    let lastError = null;
    let record = null;

    // Retry loop
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        record = await processFn(file, batchId);
        break; // success
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          logger.info(`[BULK] Retry ${attempt + 1}/${maxRetries} for ${file.originalname}: ${err.message}`);
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); // back-off
        }
      }
    }

    const outcome = record?.status || "FAILED";

    // Push to in-memory results
    if (mem) {
      mem.results.push({
        invoiceId: record?.id || null,
        invoiceNumber: record?.invoiceNumber || null,
        vendorName: record?.vendor?.name || null,
        grandTotal: record?.total || 0,
        status: outcome,
        currencyCode: record?.currencyMeta?.currency_code || null,
        originalFilename: file.originalname,
        error: lastError ? lastError.message : null,
      });
    }

    await incrementBatchCounters(batchId, outcome).catch(() => {});
    logger.info(`[BULK][${batchId}] ${record?.originalFilename || file.originalname} → ${outcome}`);
  }

  // Worker pool: run `concurrency` workers in parallel
  async function worker() {
    while (fileIndex < files.length) {
      const mem = activeBatches.get(batchId);
      if (!mem || mem.cancelled) break;
      await processNext();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.allSettled(workers);
  await completeBatch(batchId);
}
