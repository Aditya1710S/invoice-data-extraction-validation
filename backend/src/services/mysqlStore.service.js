import { pool, ensureInvoiceColumns } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

// ─── Date Formatting Helper ────────────────────────────────────────────────────
function formatMysqlDate(val) {
  if (!val) return new Date().toISOString().slice(0, 10);
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dmY = str.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmY) {
    return `${dmY[3]}-${dmY[2].padStart(2, "0")}-${dmY[1].padStart(2, "0")}`;
  }

  const yMD = str.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (yMD) {
    return `${yMD[1]}-${yMD[2].padStart(2, "0")}-${yMD[3].padStart(2, "0")}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return new Date().toISOString().slice(0, 10);
}

// ─── Save Invoice (with line items atomically) ────────────────────────────────

/**
 * Saves an invoice record and its line items to MySQL atomically using a transaction.
 * Includes all multi-currency fields. Never loses data on validation errors.
 */
export async function saveInvoiceToMysql(record) {
  const conn = await pool.getConnection();

  try {
    await ensureInvoiceColumns(conn);
    await conn.beginTransaction();

    const ext = record.extractedData || {};
    const cur = record.currencyMeta || {};

    const vendorName = ext.vendorName || record.vendor?.name || "Unknown Vendor";
    const vendorGstin = ext.vendorGst || record.vendor?.gst || null;
    const invoiceNumber = record.invoiceNumber || ext.invoiceNumber || `INV-${record.id.slice(0, 6).toUpperCase()}`;
    const invoiceDate = formatMysqlDate(record.invoiceDate || ext.invoiceDate);
    const poNumber = record.poNumber || ext.purchaseOrderNumber || null;

    const numSubtotal = Number(record.subtotal ?? ext.subtotal ?? 0);
    const subtotal = isNaN(numSubtotal) ? 0 : numSubtotal;
    const numTax = Number(record.tax ?? ext.totalTax ?? 0);
    const taxAmount = isNaN(numTax) ? 0 : numTax;
    const numGrand = Number(record.total ?? ext.totalAmount ?? subtotal + taxAmount);
    const grandTotal = isNaN(numGrand) ? 0 : numGrand;

    const validationStatus = record.status || "PENDING";
    const duplicateStatus = record.isDuplicateFile || record.status === "DUPLICATE" ? "DUPLICATE" : "NOT_DUPLICATE";
    const filePath = record.storedFilename || record.file_path || null;
    const originalFilename = record.originalFilename || null;
    const mimeType = record.mimeType || "application/pdf";
    const sizeBytes = record.sizeBytes || 0;
    const fileHash = record.fileHash || null;
    const confidence = record.confidence || 0.95;
    const rawDueDate = record.dueDate || ext.dueDate;
    const dueDate = rawDueDate ? formatMysqlDate(rawDueDate) : null;

    // Legacy currency field (backward compat)
    const legacyCurrency = cur.currency_code || ext.currency || record.currency || "INR";

    const numDiscount = Number(record.discount ?? ext.discount ?? 0);
    const discount = isNaN(numDiscount) ? 0 : numDiscount;

    const extractedJson = JSON.stringify(record.extractedData || {});
    const errorsJson = JSON.stringify(record.validationErrors || record.validation?.errors || []);
    const logsJson = JSON.stringify(record.processingLogs || []);

    // Multi-currency fields
    const currencyCode = cur.currency_code || null;
    const currencySymbol = cur.currency_symbol || null;
    const currencyName = cur.currency_name || null;
    const currencyStatus = cur.currency_status || "UNKNOWN";
    const baseCurrency = cur.base_currency || "USD";
    const exchangeRate = cur.exchange_rate ?? null;
    const convertedTotal = cur.converted_total ?? null;
    const exchangeRateDate = cur.exchange_rate_date ? formatMysqlDate(cur.exchange_rate_date) : null;
    const exchangeRateSource = cur.exchange_rate_source || null;

    // Batch tracking
    const batchId = record.batchId || null;

    const invoiceSql = `
      INSERT INTO invoices (
        invoice_id, vendor_name, vendor_gstin, invoice_number, invoice_date,
        po_number, subtotal, tax_amount, grand_total, validation_status,
        duplicate_status, file_path, original_filename, mime_type, size_bytes,
        file_hash, confidence, due_date, currency, discount,
        extracted_data_json, validation_errors_json, processing_logs_json,
        currency_code, currency_symbol, currency_name, currency_status,
        base_currency, exchange_rate, converted_total, exchange_rate_date, exchange_rate_source,
        batch_id, processing_status, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, 'COMPLETED', NOW()
      )
      ON DUPLICATE KEY UPDATE
        vendor_name = VALUES(vendor_name),
        vendor_gstin = VALUES(vendor_gstin),
        invoice_number = VALUES(invoice_number),
        invoice_date = VALUES(invoice_date),
        po_number = VALUES(po_number),
        subtotal = VALUES(subtotal),
        tax_amount = VALUES(tax_amount),
        grand_total = VALUES(grand_total),
        validation_status = VALUES(validation_status),
        duplicate_status = VALUES(duplicate_status),
        file_path = VALUES(file_path),
        validation_errors_json = VALUES(validation_errors_json),
        processing_logs_json = VALUES(processing_logs_json),
        currency_code = VALUES(currency_code),
        currency_symbol = VALUES(currency_symbol),
        currency_name = VALUES(currency_name),
        currency_status = VALUES(currency_status),
        base_currency = VALUES(base_currency),
        exchange_rate = VALUES(exchange_rate),
        converted_total = VALUES(converted_total),
        exchange_rate_date = VALUES(exchange_rate_date),
        exchange_rate_source = VALUES(exchange_rate_source),
        batch_id = VALUES(batch_id),
        updated_at = NOW();
    `;

    await conn.query(invoiceSql, [
      record.id, vendorName, vendorGstin, invoiceNumber, invoiceDate,
      poNumber, subtotal, taxAmount, grandTotal, validationStatus,
      duplicateStatus, filePath, originalFilename, mimeType, sizeBytes,
      fileHash, confidence, dueDate, legacyCurrency, discount,
      extractedJson, errorsJson, logsJson,
      currencyCode, currencySymbol, currencyName, currencyStatus,
      baseCurrency, exchangeRate, convertedTotal, exchangeRateDate, exchangeRateSource,
      batchId,
    ]);

    // Atomically insert line items (delete old ones first)
    await conn.query("DELETE FROM invoice_items WHERE invoice_id = ?;", [record.id]);

    const lineItems = record.items || ext.lineItems || [];
    if (lineItems.length > 0) {
      const itemSql = `
        INSERT INTO invoice_items
          (invoice_id, description, quantity, unit_price, tax_amount, line_total)
        VALUES ?;
      `;

      const itemValues = lineItems.map((item) => [
        record.id,
        item.name || item.description || "Line Item",
        Number(item.qty ?? item.quantity ?? 1),
        Number(item.price ?? item.unitPrice ?? 0),
        Number(item.tax ?? 0),
        Number(item.total ?? item.amount ?? 0),
      ]);

      await conn.query(itemSql, [itemValues]);
    }

    await conn.commit();
    logger.info(`Invoice ${record.id} saved to MySQL (status=${validationStatus}, currency=${currencyCode || "N/A"}).`);
    return record;
  } catch (error) {
    await conn.rollback();
    logger.error(`Error saving invoice ${record.id} to MySQL:`, error);
    throw error;
  } finally {
    conn.release();
  }
}

// ─── Read Operations ───────────────────────────────────────────────────────────

export async function getInvoiceFromMysql(id) {
  const [rows] = await pool.query("SELECT * FROM invoices WHERE invoice_id = ?;", [id]);
  if (rows.length === 0) return null;

  const row = rows[0];
  const [itemRows] = await pool.query("SELECT * FROM invoice_items WHERE invoice_id = ?;", [id]);

  return mapMysqlRowToInvoice(row, itemRows);
}

/**
 * Lists invoices with optional status filter, search, and currency filter.
 */
export async function listInvoicesFromMysql(status, search, currency) {
  let query = "SELECT * FROM invoices";
  const params = [];
  const conditions = [];

  if (status && status !== "all") {
    conditions.push("validation_status = ?");
    params.push(status.toUpperCase());
  }

  if (search) {
    conditions.push(
      "(invoice_number LIKE ? OR vendor_name LIKE ? OR original_filename LIKE ? OR invoice_id LIKE ? OR currency_code LIKE ?)"
    );
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }

  if (currency && currency !== "all") {
    conditions.push("currency_code = ?");
    params.push(currency.toUpperCase());
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY created_at DESC;";

  const [rows] = await pool.query(query, params);

  const invoices = await Promise.all(
    rows.map(async (row) => {
      const [itemRows] = await pool.query(
        "SELECT * FROM invoice_items WHERE invoice_id = ?;",
        [row.invoice_id]
      );
      return mapMysqlRowToInvoice(row, itemRows);
    })
  );

  return invoices;
}

export async function updateInvoiceInMysql(id, patch) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const fields = [];
    const params = [];

    if (patch.status !== undefined) {
      fields.push("validation_status = ?");
      params.push(patch.status.toUpperCase());
    }

    if (patch.vendor?.name !== undefined || patch.vendor_name !== undefined) {
      fields.push("vendor_name = ?");
      params.push(patch.vendor?.name || patch.vendor_name);
    }

    if (patch.vendor?.gst !== undefined || patch.vendor_gstin !== undefined) {
      fields.push("vendor_gstin = ?");
      params.push(patch.vendor?.gst || patch.vendor_gstin);
    }

    if (patch.total !== undefined || patch.grand_total !== undefined) {
      fields.push("grand_total = ?");
      params.push(patch.total || patch.grand_total);
    }

    if (patch.validationErrors !== undefined) {
      fields.push("validation_errors_json = ?");
      params.push(JSON.stringify(patch.validationErrors));
    }

    if (fields.length > 0) {
      params.push(id);
      await conn.query(`UPDATE invoices SET ${fields.join(", ")} WHERE invoice_id = ?;`, params);
    }

    await conn.commit();
    return getInvoiceFromMysql(id);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function deleteInvoiceFromMysql(id) {
  const [result] = await pool.query("DELETE FROM invoices WHERE invoice_id = ?;", [id]);
  return result.affectedRows > 0;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * Calculates all analytics metrics from MySQL with real 30-day trend percentages
 * and multi-currency distribution breakdown.
 */
export async function getAnalyticsFromMysql() {
  const [totalRow] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(grand_total) AS totalAmount, SUM(tax_amount) AS totalTax FROM invoices WHERE validation_status != 'REJECTED_DOCUMENT';"
  );
  const [statusRows] = await pool.query(
    "SELECT validation_status, COUNT(*) as count FROM invoices WHERE validation_status != 'REJECTED_DOCUMENT' GROUP BY validation_status;"
  );
  const [vendorRows] = await pool.query(
    "SELECT vendor_name, COUNT(*) as count, SUM(grand_total) as amount FROM invoices WHERE validation_status != 'REJECTED_DOCUMENT' AND vendor_name IS NOT NULL GROUP BY vendor_name ORDER BY amount DESC;"
  );
  const [monthlyRows] = await pool.query(
    "SELECT DATE_FORMAT(created_at, '%b %d') as date, COUNT(*) as count, SUM(grand_total) as amount FROM invoices WHERE validation_status != 'REJECTED_DOCUMENT' GROUP BY DATE(created_at), date ORDER BY MIN(created_at) ASC LIMIT 30;"
  );

  // Currency distribution
  const [currencyRows] = await pool.query(
    `SELECT
       COALESCE(currency_code, 'Unknown') as currency_code,
       currency_symbol,
       currency_name,
       COUNT(*) as count,
       SUM(grand_total) as total_amount,
       SUM(converted_total) as converted_total_usd
     FROM invoices
     WHERE validation_status != 'REJECTED_DOCUMENT'
     GROUP BY currency_code, currency_symbol, currency_name
     ORDER BY count DESC;`
  );

  const [trendRows] = await pool.query(`
    SELECT
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL 30 DAY THEN 1 END) AS currTotal,
      COUNT(CASE WHEN created_at < NOW() - INTERVAL 30 DAY AND created_at >= NOW() - INTERVAL 60 DAY THEN 1 END) AS prevTotal,
      COUNT(CASE WHEN validation_status = 'VALID' AND created_at >= NOW() - INTERVAL 30 DAY THEN 1 END) AS currValid,
      COUNT(CASE WHEN validation_status = 'VALID' AND created_at < NOW() - INTERVAL 30 DAY AND created_at >= NOW() - INTERVAL 60 DAY THEN 1 END) AS prevValid,
      COUNT(CASE WHEN validation_status IN ('PENDING', 'NEEDS_REVIEW') AND created_at >= NOW() - INTERVAL 30 DAY THEN 1 END) AS currPending,
      COUNT(CASE WHEN validation_status IN ('PENDING', 'NEEDS_REVIEW') AND created_at < NOW() - INTERVAL 30 DAY AND created_at >= NOW() - INTERVAL 60 DAY THEN 1 END) AS prevPending,
      COUNT(CASE WHEN validation_status IN ('ERROR', 'INVALID') AND created_at >= NOW() - INTERVAL 30 DAY THEN 1 END) AS currErr,
      COUNT(CASE WHEN validation_status IN ('ERROR', 'INVALID') AND created_at < NOW() - INTERVAL 30 DAY AND created_at >= NOW() - INTERVAL 60 DAY THEN 1 END) AS prevErr
    FROM invoices WHERE validation_status != 'REJECTED_DOCUMENT';
  `);

  const t = trendRows[0] || {};
  const calcTrend = (curr, prev) => {
    curr = Number(curr || 0);
    prev = Number(prev || 0);
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const byStatus = {};
  statusRows.forEach((r) => {
    byStatus[r.validation_status] = r.count;
  });

  return {
    total: totalRow[0].total || 0,
    valid: byStatus["VALID"] || 0,
    pending: (byStatus["PENDING"] || 0) + (byStatus["NEEDS_REVIEW"] || 0),
    needsReview: byStatus["NEEDS_REVIEW"] || 0,
    errors: (byStatus["ERROR"] || 0) + (byStatus["INVALID"] || 0),
    invalid: byStatus["INVALID"] || 0,
    duplicates: byStatus["DUPLICATE"] || 0,
    totalAmount: Number(totalRow[0].totalAmount) || 0,
    totalTax: Number(totalRow[0].totalTax) || 0,
    trends: {
      total: calcTrend(t.currTotal, t.prevTotal),
      valid: calcTrend(t.currValid, t.prevValid),
      pending: calcTrend(t.currPending, t.prevPending),
      errors: calcTrend(t.currErr, t.prevErr),
    },
    vendorStats: vendorRows.map((r) => ({
      name: r.vendor_name || "Unknown Vendor",
      count: r.count,
      amount: Number(r.amount) || 0,
    })),
    monthlyStats: monthlyRows.map((r) => ({
      date: r.date,
      count: r.count,
      amount: Number(r.amount) || 0,
    })),
    currencyDistribution: currencyRows.map((r) => ({
      code: r.currency_code,
      symbol: r.currency_symbol,
      name: r.currency_name,
      count: r.count,
      totalAmount: Number(r.total_amount) || 0,
      convertedTotalUsd: r.converted_total_usd ? Number(r.converted_total_usd) : null,
    })),
  };
}

// ─── Notifications ─────────────────────────────────────────────────────────────

export async function createNotificationInMysql({ title, message, type = "info", invoiceId = null }) {
  const id = uuidv4();
  await pool.query(
    "INSERT INTO notifications (notification_id, title, message, type, invoice_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW());",
    [id, title, message, type, invoiceId]
  );
  return { id, title, message, type, invoiceId, is_read: false, created_at: new Date().toISOString() };
}

export async function listNotificationsFromMysql() {
  const [rows] = await pool.query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50;");
  const [unreadRows] = await pool.query("SELECT COUNT(*) AS unreadCount FROM notifications WHERE is_read = 0;");

  const notifications = rows.map((r) => ({
    id: r.notification_id,
    title: r.title,
    message: r.message,
    type: r.type,
    invoiceId: r.invoice_id,
    isRead: Boolean(r.is_read),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
  }));

  return {
    notifications,
    unreadCount: unreadRows[0].unreadCount || 0,
  };
}

export async function markNotificationAsReadInMysql(id) {
  await pool.query("UPDATE notifications SET is_read = 1 WHERE notification_id = ?;", [id]);
  return true;
}

export async function markAllNotificationsAsReadInMysql() {
  await pool.query("UPDATE notifications SET is_read = 1 WHERE is_read = 0;");
  return true;
}

// ─── Row Mapper ───────────────────────────────────────────────────────────────

function mapMysqlRowToInvoice(row, itemRows = []) {
  let extractedData = null;
  let validationErrors = [];
  let processingLogs = [];

  try { extractedData = row.extracted_data_json ? JSON.parse(row.extracted_data_json) : null; } catch {}
  try { validationErrors = row.validation_errors_json ? JSON.parse(row.validation_errors_json) : []; } catch {}
  try { processingLogs = row.processing_logs_json ? JSON.parse(row.processing_logs_json) : []; } catch {}

  const items = itemRows.map((it) => ({
    id: it.item_id,
    name: it.description,
    qty: Number(it.quantity),
    price: Number(it.unit_price),
    tax: Number(it.tax_amount),
    total: Number(it.line_total),
  }));

  // Currency metadata from DB columns
  const currencyMeta = {
    currency_code: row.currency_code || null,
    currency_symbol: row.currency_symbol || null,
    currency_name: row.currency_name || null,
    currency_status: row.currency_status || "UNKNOWN",
    base_currency: row.base_currency || "USD",
    exchange_rate: row.exchange_rate ? Number(row.exchange_rate) : null,
    converted_total: row.converted_total ? Number(row.converted_total) : null,
    exchange_rate_date: row.exchange_rate_date
      ? new Date(row.exchange_rate_date).toISOString().slice(0, 10)
      : null,
    exchange_rate_source: row.exchange_rate_source || null,
  };

  return {
    id: row.invoice_id,
    invoice_id: row.invoice_id,
    invoiceNumber: row.invoice_number,
    vendor_name: row.vendor_name,
    vendor_gstin: row.vendor_gstin,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date ? new Date(row.invoice_date).toISOString().slice(0, 10) : null,
    po_number: row.po_number,
    subtotal: Number(row.subtotal),
    tax_amount: Number(row.tax_amount),
    grand_total: Number(row.grand_total),
    validation_status: row.validation_status,
    duplicate_status: row.duplicate_status,
    file_path: row.file_path,
    created_at: row.created_at,

    // Frontend-friendly aliases
    originalFilename: row.original_filename,
    storedFilename: row.file_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    fileHash: row.file_hash,
    confidence: Number(row.confidence),
    status: row.validation_status,
    isDuplicateFile: row.duplicate_status === "DUPLICATE",
    invoiceDate: row.invoice_date ? new Date(row.invoice_date).toISOString().slice(0, 10) : null,
    dueDate: row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : null,
    poNumber: row.po_number,
    currency: row.currency_code || row.currency || "INR",
    tax: Number(row.tax_amount),
    discount: Number(row.discount || 0),
    total: Number(row.grand_total),
    expectedTotal: Number(row.subtotal) + Number(row.tax_amount) - Number(row.discount || 0),
    batchId: row.batch_id || null,

    // Multi-currency object
    currencyMeta,

    vendor: {
      name: row.vendor_name || "Unknown Vendor",
      gst: row.vendor_gstin,
      address: extractedData?.vendorAddress || "N/A",
      phone: extractedData?.vendorPhone || null,
    },
    items,
    extractedData,
    validationErrors,
    processingLogs,
    uploadedAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}
