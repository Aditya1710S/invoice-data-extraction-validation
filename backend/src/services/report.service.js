import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { getInvoiceFromMysql, listInvoicesFromMysql } from "./mysqlStore.service.js";
import { pool } from "../config/db.js";

// ─── JSON Report ───────────────────────────────────────────────────────────────

/**
 * Builds a comprehensive JSON audit report for an invoice.
 * Includes original currency amounts AND USD conversion.
 */
export async function buildJsonReport(id) {
  const invoice = await getInvoiceFromMysql(id);
  if (!invoice) return null;

  const cur = invoice.currencyMeta || {};
  const currCode = cur.currency_code || invoice.currency || "INR";
  const currSym = cur.currency_symbol || "";

  return {
    reportTitle: "InvoiceFlow Validation Audit Report",
    generatedAt: new Date().toISOString(),
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      poNumber: invoice.poNumber,
      currency: {
        code: currCode,
        symbol: currSym,
        name: cur.currency_name || currCode,
        status: cur.currency_status || "UNKNOWN",
      },
      originalAmounts: {
        subtotal: invoice.subtotal,
        taxAmount: invoice.tax_amount,
        discount: invoice.discount,
        grandTotal: invoice.grand_total,
      },
      convertedAmounts: cur.exchange_rate
        ? {
            baseCurrency: cur.base_currency || "USD",
            exchangeRate: cur.exchange_rate,
            exchangeRateDate: cur.exchange_rate_date,
            exchangeRateSource: cur.exchange_rate_source,
            convertedTotal: cur.converted_total,
          }
        : null,
      validationStatus: invoice.validation_status,
      duplicateStatus: invoice.duplicate_status,
      confidence: invoice.confidence,
    },
    vendor: {
      name: invoice.vendor_name,
      gstin: invoice.vendor_gstin,
      address: invoice.vendor?.address,
      phone: invoice.vendor?.phone,
    },
    lineItems: (invoice.items || []).map((item) => ({
      description: item.name,
      quantity: item.qty,
      unitPrice: item.price,
      taxAmount: item.tax,
      lineTotal: item.total,
      currency: currCode,
    })),
    validationChecks: {
      status: invoice.validation_status,
      errorsCount: (invoice.validationErrors || []).length,
      errors: invoice.validationErrors || [],
    },
    processingLogs: invoice.processingLogs || [],
  };
}

// ─── PDF Report ────────────────────────────────────────────────────────────────

/**
 * Generates a downloadable PDF report stream for an invoice.
 * Shows original currency amounts clearly.
 */
export async function generatePdfReport(id, res) {
  const invoice = await getInvoiceFromMysql(id);
  if (!invoice) {
    res.status(404).send("Invoice not found");
    return;
  }

  const cur = invoice.currencyMeta || {};
  const currCode = cur.currency_code || invoice.currency || "";
  const currSym = cur.currency_symbol || "";
  const fmtAmt = (n) => `${currSym}${Number(n || 0).toLocaleString("en-US")}${currCode ? ` ${currCode}` : ""}`;

  const doc = new PDFDocument({ margin: 40, size: "A4" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="Invoice_Report_${invoice.invoiceNumber || id}.pdf"`
  );
  doc.pipe(res);

  // Header Banner
  doc
    .fillColor("#0B1D33")
    .fontSize(20)
    .text("InvoiceFlow — Audit Report", { align: "left" })
    .fontSize(10)
    .fillColor("#7C8DA6")
    .text(`Generated on: ${new Date().toLocaleString("en-US")}`)
    .moveDown(1.5);

  doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor("#E4E9F1").stroke().moveDown(1);

  // Summary Grid
  const startY = doc.y;
  doc
    .fontSize(12).fillColor("#0B1D33").text("Invoice Information", 40, startY, { bold: true })
    .fontSize(9).fillColor("#33475B")
    .text(`Invoice #: ${invoice.invoiceNumber || "N/A"}`, 40, startY + 20)
    .text(`Invoice Date: ${invoice.invoiceDate || "N/A"}`, 40, startY + 34)
    .text(`PO Number: ${invoice.poNumber || "N/A"}`, 40, startY + 48)
    .text(`Status: ${invoice.validation_status}`, 40, startY + 62);

  doc
    .fontSize(12).fillColor("#0B1D33").text("Vendor Details", 300, startY, { bold: true })
    .fontSize(9).fillColor("#33475B")
    .text(`Vendor: ${invoice.vendor_name || "N/A"}`, 300, startY + 20)
    .text(`GSTIN/VAT: ${invoice.vendor_gstin || "Missing"}`, 300, startY + 34);

  doc.moveDown(6);

  // Currency Info Box
  const curBoxY = doc.y;
  const curStatus = cur.currency_status || "UNKNOWN";
  const curColor = curStatus === "CONFIDENT" ? "#1C9A6C" : curStatus === "DETECTED" ? "#2E6BE6" : "#C8790A";
  doc
    .rect(40, curBoxY, 510, 30).fillAndStroke("#F0F7FF", "#DAEEFF")
    .fontSize(9).fillColor(curColor)
    .text(
      `Currency: ${currCode || "Unknown"} ${currSym}  |  Name: ${cur.currency_name || "N/A"}  |  Detection: ${curStatus}${cur.exchange_rate ? `  |  1 ${currCode} = ${cur.exchange_rate} ${cur.base_currency}` : ""}`,
      55, curBoxY + 8, { width: 480 }
    );

  doc.moveDown(3);

  // Financial Totals Box
  const boxY2 = doc.y;
  doc.rect(40, boxY2, 510, 45).fillAndStroke("#F5F7FA", "#E4E9F1");
  doc
    .fillColor("#0B1D33").fontSize(10)
    .text(`Subtotal: ${fmtAmt(invoice.subtotal)}`, 55, boxY2 + 8)
    .text(`Tax: ${fmtAmt(invoice.tax_amount)}`, 210, boxY2 + 8)
    .fontSize(11).fillColor("#2E6BE6")
    .text(`Grand Total: ${fmtAmt(invoice.grand_total)}`, 370, boxY2 + 8);

  if (cur.converted_total) {
    doc.fontSize(8).fillColor("#7C8DA6")
      .text(`≈ ${cur.converted_total.toLocaleString("en-US")} ${cur.base_currency || "USD"} (converted @ ${cur.exchange_rate} on ${cur.exchange_rate_date})`, 55, boxY2 + 28, { width: 480 });
  }

  doc.moveDown(3);

  // Line Items Table
  doc.fontSize(11).fillColor("#0B1D33").text("Line Items Breakdown", 40).moveDown(0.5);

  const tableTop = doc.y;
  doc.fontSize(9).fillColor("#7C8DA6")
    .text("Description", 40, tableTop)
    .text("Qty", 260, tableTop, { width: 40, align: "right" })
    .text(`Unit Price (${currCode})`, 310, tableTop, { width: 80, align: "right" })
    .text("Tax", 395, tableTop, { width: 55, align: "right" })
    .text(`Total (${currCode})`, 460, tableTop, { width: 80, align: "right" });

  doc.moveTo(40, tableTop + 14).lineTo(550, tableTop + 14).strokeColor("#E4E9F1").stroke();

  let itemY = tableTop + 22;
  (invoice.items || []).forEach((item) => {
    doc.fontSize(9).fillColor("#33475B")
      .text(item.name || "Line Item", 40, itemY, { width: 210 })
      .text(String(item.qty || 1), 260, itemY, { width: 40, align: "right" })
      .text(`${currSym}${Number(item.price || 0).toLocaleString("en-US")}`, 310, itemY, { width: 80, align: "right" })
      .text(`${currSym}${Number(item.tax || 0).toLocaleString("en-US")}`, 395, itemY, { width: 55, align: "right" })
      .text(`${currSym}${Number(item.total || 0).toLocaleString("en-US")}`, 460, itemY, { width: 80, align: "right" });
    itemY += 18;
  });

  doc.moveDown(2);

  // Validation Section
  doc.fontSize(11).fillColor("#0B1D33").text("Automated Validation Checks", 40).moveDown(0.5);

  const errors = invoice.validationErrors || [];
  if (errors.length === 0) {
    doc.fontSize(9).fillColor("#1C9A6C").text("✓ All validation checks passed cleanly.", 40);
  } else {
    errors.forEach((e) => {
      doc.fontSize(9)
        .fillColor(e.severity === "error" ? "#D2453A" : "#C8790A")
        .text(`• [${e.type}] ${e.message}`, 40);
    });
  }

  doc.end();
}

// ─── Single Invoice Excel Report ───────────────────────────────────────────────

/**
 * Generates a downloadable Excel report (.xlsx) for an invoice.
 * Includes original currency amounts AND USD equivalent columns.
 */
export async function generateExcelReport(id, res) {
  const invoice = await getInvoiceFromMysql(id);
  if (!invoice) {
    res.status(404).send("Invoice not found");
    return;
  }

  const cur = invoice.currencyMeta || {};
  const currCode = cur.currency_code || invoice.currency || "INR";

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Invoice Audit Report");

  // Title
  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = "InvoiceFlow Validation Audit Report";
  sheet.getCell("A1").font = { size: 16, bold: true };

  sheet.addRow([]);

  // Invoice Summary
  sheet.addRow(["Invoice Summary"]);
  sheet.getRow(3).font = { bold: true, size: 12 };

  sheet.addRow(["Invoice Number", invoice.invoiceNumber, "Vendor Name", invoice.vendor_name]);
  sheet.addRow(["Invoice Date", invoice.invoiceDate, "Vendor GSTIN/VAT", invoice.vendor_gstin || "Missing"]);
  sheet.addRow(["PO Number", invoice.poNumber || "N/A", "Validation Status", invoice.validation_status]);

  // Currency Details
  sheet.addRow([]);
  sheet.addRow(["Currency Information"]);
  sheet.getRow(sheet.rowCount).font = { bold: true, size: 11 };
  sheet.addRow(["Currency Code", currCode, "Currency Name", cur.currency_name || "N/A", "Detection Status", cur.currency_status || "UNKNOWN"]);

  // Original Amounts
  sheet.addRow([]);
  sheet.addRow(["Financial Summary (Original Currency)"]);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  sheet.addRow([`Subtotal (${currCode})`, invoice.subtotal, `Tax (${currCode})`, invoice.tax_amount, `Grand Total (${currCode})`, invoice.grand_total]);

  // USD Conversion
  if (cur.exchange_rate && cur.converted_total) {
    sheet.addRow([]);
    sheet.addRow(["USD Equivalent"]);
    sheet.getRow(sheet.rowCount).font = { bold: true };
    sheet.addRow([`Exchange Rate (1 ${currCode} = ? ${cur.base_currency})`, cur.exchange_rate, "Rate Date", cur.exchange_rate_date, `Total ${cur.base_currency}`, cur.converted_total]);
  }

  sheet.addRow([]);

  // Line Items
  sheet.addRow(["Line Items"]);
  sheet.getRow(sheet.rowCount).font = { bold: true, size: 12 };

  const hdr = sheet.addRow([
    "#", "Description", "Quantity", `Unit Price (${currCode})`, `Tax (${currCode})`, `Line Total (${currCode})`,
  ]);
  hdr.font = { bold: true };
  hdr.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F7FA" } };
  });

  (invoice.items || []).forEach((item, idx) => {
    sheet.addRow([idx + 1, item.name, item.qty, item.price, item.tax, item.total]);
  });

  sheet.addRow([]);

  // Validation Results
  sheet.addRow(["Validation Results"]);
  sheet.getRow(sheet.rowCount).font = { bold: true, size: 12 };

  const errors = invoice.validationErrors || [];
  if (errors.length === 0) {
    sheet.addRow(["Result", "✓ All validation checks passed."]);
  } else {
    sheet.addRow(["Severity", "Error Type", "Message"]);
    errors.forEach((e) => {
      sheet.addRow([e.severity?.toUpperCase(), e.type, e.message]);
    });
  }

  sheet.columns = [
    { width: 20 }, { width: 35 }, { width: 15 }, { width: 20 }, { width: 18 }, { width: 22 }, { width: 20 },
  ];

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Invoice_Report_${invoice.invoiceNumber || id}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

// ─── Batch Excel Report ────────────────────────────────────────────────────────

/**
 * Generates a bulk batch Excel report with all invoices in a batch.
 * Each row contains: invoice details + currency info + validation status.
 */
export async function generateBatchExcelReport(batchId, res) {
  const [rows] = await pool.query(
    `SELECT i.*, ii.item_count
     FROM invoices i
     LEFT JOIN (
       SELECT invoice_id, COUNT(*) as item_count FROM invoice_items GROUP BY invoice_id
     ) ii ON i.invoice_id = ii.invoice_id
     WHERE i.batch_id = ?
     ORDER BY i.created_at ASC`,
    [batchId]
  );

  if (!rows.length) {
    res.status(404).send("No invoices found for this batch.");
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Batch ${batchId}`);

  // Title
  sheet.mergeCells("A1:N1");
  sheet.getCell("A1").value = `InvoiceFlow — Batch Report: ${batchId}`;
  sheet.getCell("A1").font = { size: 14, bold: true };
  sheet.addRow([`Generated: ${new Date().toLocaleString("en-US")}  |  Total: ${rows.length} invoices`]);
  sheet.addRow([]);

  // Header Row
  const header = sheet.addRow([
    "#",
    "Invoice ID",
    "Invoice Number",
    "Vendor Name",
    "Invoice Date",
    "Validation Status",
    "Currency Code",
    "Currency Name",
    "Subtotal",
    "Tax Amount",
    "Grand Total",
    "Exchange Rate",
    "Converted Total (USD)",
    "Line Items",
  ]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0B1D33" } };
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
  });

  // Data Rows
  rows.forEach((row, idx) => {
    const dataRow = sheet.addRow([
      idx + 1,
      row.invoice_id,
      row.invoice_number || "N/A",
      row.vendor_name || "Unknown",
      row.invoice_date ? new Date(row.invoice_date).toISOString().slice(0, 10) : "N/A",
      row.validation_status || "UNKNOWN",
      row.currency_code || row.currency || "N/A",
      row.currency_name || "N/A",
      Number(row.subtotal || 0),
      Number(row.tax_amount || 0),
      Number(row.grand_total || 0),
      row.exchange_rate ? Number(row.exchange_rate) : "N/A",
      row.converted_total ? Number(row.converted_total) : "N/A",
      row.item_count || 0,
    ]);

    // Color-code validation status
    const statusCell = dataRow.getCell(6);
    const statusColors = {
      VALID: "C6EFCE",
      INVALID: "FFC7CE",
      PENDING: "FFEB9C",
      DUPLICATE: "DDEBF7",
      NEEDS_REVIEW: "FCE4D6",
      FAILED: "F2F2F2",
    };
    const bgColor = statusColors[row.validation_status] || "FFFFFF";
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
  });

  // Column widths
  sheet.columns = [
    { width: 5 }, { width: 38 }, { width: 18 }, { width: 28 }, { width: 14 },
    { width: 18 }, { width: 14 }, { width: 20 }, { width: 14 }, { width: 14 },
    { width: 16 }, { width: 16 }, { width: 22 }, { width: 12 },
  ];

  // Summary sheet
  const sumSheet = workbook.addWorksheet("Summary");
  const byStatus = {};
  rows.forEach((r) => {
    byStatus[r.validation_status] = (byStatus[r.validation_status] || 0) + 1;
  });

  sumSheet.addRow(["Batch Summary"]);
  sumSheet.getRow(1).font = { bold: true, size: 14 };
  sumSheet.addRow(["Batch ID", batchId]);
  sumSheet.addRow(["Total Invoices", rows.length]);
  Object.entries(byStatus).forEach(([status, count]) => {
    sumSheet.addRow([status, count]);
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Batch_Report_${batchId}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}
