import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { hashFile } from "../utils/hashFile.js";
import { resolveStoredFilePath } from "../utils/fileStorage.js";
import { logger } from "../utils/logger.js";
import { isDocumentAiConfigured } from "../config/env.js";
import { processInvoiceFile } from "../services/documentAi.service.js";
import { validateExtractedInvoice, parseAmount } from "../services/validation.service.js";
import { resolveCurrencyForInvoice, CURRENCY_REGISTRY } from "../services/currency.service.js";
import {
  createNotificationInMysql,
  listNotificationsFromMysql,
  markNotificationAsReadInMysql,
  markAllNotificationsAsReadInMysql,
  saveInvoiceToMysql,
  getInvoiceFromMysql,
  listInvoicesFromMysql,
  updateInvoiceInMysql,
  deleteInvoiceFromMysql,
  getAnalyticsFromMysql,
} from "../services/mysqlStore.service.js";
import {
  buildJsonReport,
  generatePdfReport,
  generateExcelReport,
  generateBatchExcelReport,
} from "../services/report.service.js";
import {
  createBatchInMysql,
  getBatchStatus,
  cancelBatch,
  runBulkQueue,
} from "../services/bulkQueue.service.js";

export const PIPELINE_STATUS = {
  UPLOADED: "UPLOADED",
  DUPLICATE_FILE: "DUPLICATE_FILE",
  EXTRACTED: "EXTRACTED",
  VALID: "VALID",
  PENDING: "PENDING",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  ERROR: "ERROR",
  INVALID: "INVALID",
  DUPLICATE: "DUPLICATE",
  REJECTED_DOCUMENT: "REJECTED_DOCUMENT",
  PROCESSING_ERROR: "PROCESSING_ERROR",
};

/**
 * Core invoice processing pipeline:
 * File hash → Document AI / fallback → Invoice detection → Currency detection
 * → Validation (in original currency) → Save to MySQL
 */
async function processUploadedInvoice(file, batchId = null) {
  const absolutePath = resolveStoredFilePath(file.filename);
  const fileHash = await hashFile(absolutePath);

  const existingInvoices = await listInvoicesFromMysql();
  const existingMatch = existingInvoices.find((inv) => inv.fileHash === fileHash);
  const now = new Date().toISOString();

  const record = {
    id: uuidv4(),
    originalFilename: file.originalname,
    storedFilename: file.filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    fileHash,
    batchId,
    status: existingMatch ? PIPELINE_STATUS.DUPLICATE : PIPELINE_STATUS.UPLOADED,
    isDuplicateFile: Boolean(existingMatch),
    duplicateOfId: existingMatch ? existingMatch.id : null,
    extractedData: null,
    currencyMeta: null,
    documentAi: null,
    validation: null,
    validationErrors: [],
    confidence: 0.95,
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

  // Exact duplicate file
  if (existingMatch) {
    record.validationErrors = [
      {
        type: "Duplicate File",
        message: `Exact file match found (Invoice ID: ${existingMatch.id}).`,
        severity: "warning",
      },
    ];
    await saveInvoiceToMysql(record);
    if (!batchId) {
      await createNotificationInMysql({
        title: "Duplicate Invoice Detected",
        message: `File '${record.originalFilename}' matches an existing invoice byte-for-byte (ID: ${existingMatch.id}).`,
        type: "warning",
        invoiceId: record.id,
      });
    }
    return record;
  }

  try {
    logger.info(`Starting invoice processing: ${record.id}`, {
      filename: record.originalFilename,
      mimeType: record.mimeType,
    });

    const extraction = await processInvoiceFile(
      absolutePath,
      record.mimeType,
      record.originalFilename
    );

    // 1. Strict Invoice Document Detection
    if (extraction.detectionResult && !extraction.detectionResult.isInvoice) {
      console.warn(
        `❌ Non-Invoice Document Rejected: ${record.originalFilename} (Evidence Score: ${extraction.detectionResult.evidenceScore})`
      );

      try {
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
      } catch {}

      if (!batchId) {
        await createNotificationInMysql({
          title: "Invalid Document Rejected",
          message: `Uploaded file '${record.originalFilename}' does not appear to be a valid invoice.`,
          type: "warning",
          invoiceId: null,
        });
      }

      const err = new Error("The uploaded document does not appear to be a valid invoice.");
      err.status = 400;
      err.code = "INVALID_INVOICE_DOCUMENT";
      err.details = extraction.detectionResult.missingDetails || [
        "Required invoice structure or invoice keywords were not detected.",
      ];
      err.stage = "invoice_detection";
      err.evidenceScore = extraction.detectionResult.evidenceScore;
      throw err;
    }

    record.extractedData = extraction.extractedData;
    record.documentAi = extraction.processor;

    // 2. Currency Detection & Exchange Rate Resolution
    const ext = record.extractedData || {};
    const grandTotalForCurrency = parseAmount(ext.totalAmount || ext.grandTotal || ext.total || 0);

    record.currencyMeta = await resolveCurrencyForInvoice(
      ext,
      extraction.text || "",
      grandTotalForCurrency,
      ext.invoiceDate || null
    );

    // 3. Validation — always in original invoice currency
    const validationResult = validateExtractedInvoice(
      record.extractedData,
      existingInvoices,
      record.id,
      record.currencyMeta // pass currency info for descriptive error messages
    );

    record.validation = validationResult;
    record.validationErrors = validationResult.errors;
    record.status = validationResult.status;

    if (validationResult.duplicateOfId) {
      record.duplicateOfId = validationResult.duplicateOfId;
      record.isDuplicateFile = false;
    }

    record.invoiceNumber = ext.invoiceNumber || `INV-${record.id.slice(0, 6).toUpperCase()}`;
    record.invoiceDate = ext.invoiceDate || new Date().toISOString().slice(0, 10);
    record.dueDate = ext.dueDate || null;
    record.poNumber = ext.purchaseOrderNumber || null;
    record.currency = record.currencyMeta?.currency_code || ext.currency || null;

    record.subtotal = validationResult.extractedSubtotal || parseAmount(ext.subtotal || ext.netAmount);
    record.tax = validationResult.extractedTax || parseAmount(ext.totalTax || ext.taxAmount);
    record.discount = parseAmount(ext.discount);
    record.total = validationResult.extractedGrandTotal || parseAmount(ext.totalAmount || ext.grandTotal || ext.total);
    record.calculatedSubtotal = validationResult.calculatedSubtotal;
    record.calculatedTax = validationResult.calculatedTax;
    record.expectedTotal = validationResult.calculatedGrandTotal;
    record.difference = validationResult.difference;

    record.vendor = {
      name: ext.vendorName || "Unknown Vendor",
      gst: ext.vendorGst || null,
      address: ext.vendorAddress || "N/A",
      phone: ext.vendorPhone || null,
    };

    record.items = (ext.lineItems || []).map((it, idx) => ({
      id: idx,
      name: it.description || it.name || "Line Item",
      qty: parseAmount(it.quantity ?? it.qty ?? 1),
      price: parseAmount(it.unitPrice ?? it.price ?? 0),
      tax: parseAmount(it.tax ?? 0),
      total:
        parseAmount(it.amount ?? it.total ?? it.line_total) ||
        parseAmount(it.quantity ?? 1) * parseAmount(it.unitPrice ?? 0),
    }));

    record.processingLogs.push({
      stage: "document_ai",
      status: "success",
      message: extraction.fallbackUsed
        ? "Processed via intelligent local parser (GCP billing required for raw Document AI API)."
        : "Invoice successfully processed by Google Cloud Document AI Invoice Parser.",
      timestamp: new Date().toISOString(),
    });

    // Log currency detection
    record.processingLogs.push({
      stage: "currency_detection",
      status: record.currencyMeta.currency_status === "UNKNOWN" ? "warning" : "success",
      message: record.currencyMeta.currency_reason || `Currency: ${record.currencyMeta.currency_code || "Unknown"}`,
      timestamp: new Date().toISOString(),
    });

    record.updatedAt = new Date().toISOString();

    // 4. Save to MySQL atomically
    try {
      await saveInvoiceToMysql(record);
      logger.info(`Invoice ${record.id} saved to MySQL (status=${record.status}, currency=${record.currencyMeta?.currency_code || "N/A"}).`);

      // Create notifications (only for non-batch uploads or INVALID invoices)
      const currCode = record.currencyMeta?.currency_code || "";
      const currSym = record.currencyMeta?.currency_symbol || "";
      const totalDisplay = `${currSym}${record.total?.toLocaleString("en-US")}${currCode ? ` ${currCode}` : ""}`;

      if (!batchId) {
        if (record.status === "VALID") {
          await createNotificationInMysql({
            title: "Invoice Processed",
            message: `Invoice ${record.invoiceNumber} (${record.vendor?.name}) processed successfully. Total: ${totalDisplay}`,
            type: "success",
            invoiceId: record.id,
          });
        } else if (record.status === "INVALID") {
          await createNotificationInMysql({
            title: "Validation Error Detected",
            message: `Calculation error in ${record.invoiceNumber} — Declared: ${totalDisplay}, Expected: ${currSym}${record.expectedTotal?.toLocaleString("en-US")}${currCode ? ` ${currCode}` : ""}.`,
            type: "error",
            invoiceId: record.id,
          });
        } else if (record.status === "NEEDS_REVIEW") {
          await createNotificationInMysql({
            title: "Manual Review Needed",
            message: `Invoice ${record.invoiceNumber} needs a manual review due to incomplete or ambiguous data. Total: ${totalDisplay}`,
            type: "warning",
            invoiceId: record.id,
          });
        } else if (record.status === "DUPLICATE") {
          await createNotificationInMysql({
            title: "Duplicate Invoice Detected",
            message: `Invoice ${record.invoiceNumber} matches existing record in database.`,
            type: "warning",
            invoiceId: record.id,
          });
        }
      }
    } catch (dbError) {
      console.error("❌ MySQL Database Save Error:", dbError.message || dbError);
      if (dbError.stack) console.error("❌ MySQL Stack Trace:\n", dbError.stack);
      dbError.stage = "mysql";
      throw dbError;
    }

    return record;
  } catch (error) {
    if (error.code === "INVALID_INVOICE_DOCUMENT") {
      throw error;
    }

    console.error("❌ Invoice Processing Error:", error.message || error);
    if (error.stack) console.error("❌ Error Stack Trace:\n", error.stack);

    const errorMessage = error?.message || "Unknown document processing error.";
    record.status = PIPELINE_STATUS.PROCESSING_ERROR;
    record.updatedAt = new Date().toISOString();

    record.processingLogs.push({
      stage: "document_ai",
      status: "error",
      message: errorMessage,
      timestamp: record.updatedAt,
    });

    try {
      await saveInvoiceToMysql(record);
    } catch (saveErr) {
      console.error("❌ Failed to save error record to MySQL:", saveErr.message || saveErr);
      saveErr.stage = "mysql";
      throw saveErr;
    }

    logger.error(`Document processing failed for ${record.id}:`, errorMessage);
    return record;
  }
}

// ─── HTTP Handler: Single Upload ───────────────────────────────────────────────

export async function uploadSingleInvoice(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file received. Attach a file under 'invoice'.",
        stage: "file_upload",
      });
    }

    console.log(`📄 Uploaded: ${req.file.originalname} | ${req.file.mimetype} | ${req.file.size} bytes`);

    const record = await processUploadedInvoice(req.file, null);

    return res.status(201).json({
      success: true,
      invoice: record,
      documentAiConfigured: isDocumentAiConfigured(),
    });
  } catch (err) {
    next(err);
  }
}

// ─── HTTP Handler: Async Bulk Upload ──────────────────────────────────────────

export async function uploadBulkInvoices(req, res, next) {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "No files received. Attach under 'invoices'." });
    }

    // Create batch record immediately and return batchId — non-blocking
    const batchId = await createBatchInMysql(files.length);

    // Fire and forget — runs in background
    setImmediate(() => {
      runBulkQueue(batchId, files, (file, bid) => processUploadedInvoice(file, bid)).catch(
        (err) => logger.error(`[BULK] Batch ${batchId} failed:`, err.message)
      );
    });

    return res.status(202).json({
      success: true,
      batchId,
      totalFiles: files.length,
      message: `Batch of ${files.length} invoices queued. Poll GET /api/invoices/batch/${batchId} for live progress.`,
    });
  } catch (err) {
    next(err);
  }
}

// ─── HTTP Handler: Batch Status ────────────────────────────────────────────────

export async function getBatchStatusHandler(req, res, next) {
  try {
    const { batchId } = req.params;
    const status = await getBatchStatus(batchId);
    if (!status) {
      return res.status(404).json({ error: `Batch ${batchId} not found.` });
    }
    return res.json({ success: true, batch: status });
  } catch (err) {
    next(err);
  }
}

// ─── HTTP Handler: Cancel Batch ────────────────────────────────────────────────

export async function cancelBatchHandler(req, res, next) {
  try {
    const { batchId } = req.params;
    await cancelBatch(batchId);
    return res.json({ success: true, message: `Batch ${batchId} cancellation requested.` });
  } catch (err) {
    next(err);
  }
}

// ─── HTTP Handler: Batch Excel Report ─────────────────────────────────────────

export async function getBatchReportExcel(req, res, next) {
  try {
    const { batchId } = req.params;
    await generateBatchExcelReport(batchId, res);
  } catch (err) {
    next(err);
  }
}

// ─── HTTP Handler: Supported Currencies List ──────────────────────────────────

export function getSupportedCurrencies(_req, res) {
  const currencies = Object.values(CURRENCY_REGISTRY).map((c) => ({
    code: c.code,
    symbol: c.symbol,
    name: c.name,
  }));
  return res.json({ success: true, currencies });
}

// ─── Invoice CRUD ──────────────────────────────────────────────────────────────

export async function getInvoices(req, res, next) {
  try {
    const { status, search, currency } = req.query;
    const invoices = await listInvoicesFromMysql(status, search, currency);
    return res.json({ count: invoices.length, invoices });
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceDetail(req, res, next) {
  try {
    const invoice = await getInvoiceFromMysql(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: `Invoice ${req.params.id} not found` });
    }
    return res.json({ invoice });
  } catch (err) {
    next(err);
  }
}

export async function approveInvoice(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await updateInvoiceInMysql(id, { status: PIPELINE_STATUS.VALID, validationErrors: [] });
    return res.json({ success: true, invoice: updated });
  } catch (err) {
    next(err);
  }
}

export async function rejectInvoice(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await updateInvoiceInMysql(id, { status: PIPELINE_STATUS.ERROR });
    return res.json({ success: true, invoice: updated });
  } catch (err) {
    next(err);
  }
}

export async function updateInvoiceFields(req, res, next) {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const updated = await updateInvoiceInMysql(id, patch);
    return res.json({ success: true, invoice: updated });
  } catch (err) {
    next(err);
  }
}

export async function deleteInvoiceRecord(req, res, next) {
  try {
    const { id } = req.params;
    const invoice = await getInvoiceFromMysql(id);

    if (invoice && invoice.storedFilename) {
      try {
        const filePath = resolveStoredFilePath(invoice.storedFilename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (err) {
        logger.warn(`Could not delete file for invoice ${id}: ${err.message}`);
      }
    }

    const deleted = await deleteInvoiceFromMysql(id);
    return res.json({ success: deleted, message: `Invoice ${id} deleted` });
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceFile(req, res, next) {
  try {
    const { id } = req.params;
    const invoice = await getInvoiceFromMysql(id);

    if (!invoice) return res.status(404).send("Invoice not found");

    const filePath = resolveStoredFilePath(invoice.storedFilename);
    if (!fs.existsSync(filePath)) return res.status(404).send("File not found on server");

    return res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────

export async function getDashboardStats(_req, res, next) {
  try {
    const stats = await getAnalyticsFromMysql();
    return res.json({ ...stats, documentAiConfigured: isDocumentAiConfigured() });
  } catch (err) {
    next(err);
  }
}

// ─── Reports ───────────────────────────────────────────────────────────────────

export async function getInvoiceReportJson(req, res, next) {
  try {
    const report = await buildJsonReport(req.params.id);
    if (!report) return res.status(404).json({ error: "Invoice not found" });
    return res.json(report);
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceReportPdf(req, res, next) {
  try {
    await generatePdfReport(req.params.id, res);
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceReportExcel(req, res, next) {
  try {
    await generateExcelReport(req.params.id, res);
  } catch (err) {
    next(err);
  }
}

// ─── Notifications ─────────────────────────────────────────────────────────────

export async function getNotifications(_req, res, next) {
  try {
    const result = await listNotificationsFromMysql();
    return res.json({
      success: true,
      count: result.notifications.length,
      unreadCount: result.unreadCount,
      notifications: result.notifications,
    });
  } catch (err) {
    next(err);
  }
}

export async function markNotificationAsRead(req, res, next) {
  try {
    const { id } = req.params;
    await markNotificationAsReadInMysql(id);
    return res.json({ success: true, message: `Notification ${id} marked as read.` });
  } catch (err) {
    next(err);
  }
}

export async function markAllNotificationsAsRead(_req, res, next) {
  try {
    await markAllNotificationsAsReadInMysql();
    return res.json({ success: true, message: "All notifications marked as read." });
  } catch (err) {
    next(err);
  }
}