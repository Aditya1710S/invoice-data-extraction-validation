import { Router } from "express";
import { uploadSingle, uploadMultiple, handleUploadErrors } from "../middleware/upload.middleware.js";
import {
  uploadSingleInvoice,
  uploadBulkInvoices,
  getBatchStatusHandler,
  cancelBatchHandler,
  getBatchReportExcel,
  getSupportedCurrencies,
  getInvoices,
  getInvoiceDetail,
  approveInvoice,
  rejectInvoice,
  updateInvoiceFields,
  deleteInvoiceRecord,
  getInvoiceFile,
  getInvoiceReportJson,
  getInvoiceReportPdf,
  getInvoiceReportExcel,
} from "../controllers/invoices.controller.js";

export const invoicesRouter = Router();

// ── Single Invoice Upload ──────────────────────────────────────────────────────
invoicesRouter.post("/upload", uploadSingle, handleUploadErrors, uploadSingleInvoice);

// ── Bulk Invoice Upload (async, returns batchId immediately) ───────────────────
invoicesRouter.post("/bulk-upload", uploadMultiple, handleUploadErrors, uploadBulkInvoices);

// ── Batch Operations ───────────────────────────────────────────────────────────
invoicesRouter.get("/batch/:batchId", getBatchStatusHandler);
invoicesRouter.post("/batch/:batchId/cancel", cancelBatchHandler);
invoicesRouter.get("/batch/:batchId/report/excel", getBatchReportExcel);

// ── Supported Currencies ───────────────────────────────────────────────────────
invoicesRouter.get("/currencies", getSupportedCurrencies);

// ── Invoice List & Detail ──────────────────────────────────────────────────────
invoicesRouter.get("/", getInvoices);
invoicesRouter.get("/:id", getInvoiceDetail);
invoicesRouter.get("/:id/file", getInvoiceFile);

// ── Per-Invoice Reports ────────────────────────────────────────────────────────
invoicesRouter.get("/:id/report", getInvoiceReportJson);
invoicesRouter.get("/:id/report/pdf", getInvoiceReportPdf);
invoicesRouter.get("/:id/report/excel", getInvoiceReportExcel);

// ── Update / Status ────────────────────────────────────────────────────────────
invoicesRouter.put("/:id", updateInvoiceFields);
invoicesRouter.post("/:id/approve", approveInvoice);
invoicesRouter.post("/:id/reject", rejectInvoice);
invoicesRouter.delete("/:id", deleteInvoiceRecord);
