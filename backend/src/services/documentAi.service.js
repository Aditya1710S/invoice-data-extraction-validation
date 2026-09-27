import fs from "node:fs";
import path from "node:path";
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { env } from "../config/env.js";

const client = new DocumentProcessorServiceClient({
  apiEndpoint: `${env.documentAi.location}-documentai.googleapis.com`,
});

function getProcessorName() {
  return `projects/${env.documentAi.projectId}/locations/${env.documentAi.location}/processors/${env.documentAi.processorId}`;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function getEntityValue(entity) {
  if (!entity) return null;
  const normalized = normalizeText(entity.normalizedValue?.text);
  if (normalized) {
    return normalized;
  }
  return normalizeText(entity.mentionText);
}

function getEntityNumber(entity) {
  if (!entity) return null;
  const normalized = entity.normalizedValue;
  if (normalized?.moneyValue) {
    return {
      currencyCode: normalized.moneyValue.currencyCode || null,
      units: normalized.moneyValue.units ?? null,
      nanos: normalized.moneyValue.nanos ?? null,
    };
  }
  if (normalized?.numberValue !== undefined) {
    return normalized.numberValue;
  }
  return null;
}

function extractLineItem(entity) {
  const item = {
    description: null,
    quantity: null,
    unitPrice: null,
    amount: null,
    raw: getEntityValue(entity),
  };

  for (const property of entity.properties || []) {
    const type = String(property.type || "").toLowerCase();
    const value = getEntityValue(property);

    if (type === "line_item/description" || type.includes("description")) {
      item.description = value;
    } else if (type === "line_item/quantity" || type.includes("quantity")) {
      item.quantity = value;
    } else if (type === "line_item/unit_price" || type.includes("unit_price")) {
      item.unitPrice = value;
    } else if (
      type === "line_item/amount" ||
      type.includes("line_total") ||
      type.includes("/amount")
    ) {
      item.amount = value;
    }
  }

  return item;
}

function extractEntities(document) {
  const entities = document.entities || [];

  const result = {
    vendorName: null,
    vendorAddress: null,
    vendorPhone: null,
    vendorGst: null,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    purchaseOrderNumber: null,
    subtotal: null,
    netAmount: null,
    totalTax: null,
    totalAmount: null,
    currency: null,
    lineItems: [],
    rawEntities: [],
  };

  for (const entity of entities) {
    const type = String(entity.type || "");
    const value = getEntityValue(entity);
    const typeLower = type.toLowerCase();
    const moneyVal = getEntityNumber(entity);

    result.rawEntities.push({
      type,
      value,
      confidence: entity.confidence ?? null,
      normalizedValue: moneyVal,
    });

    // Capture currency from money values (Document AI moneyValue.currencyCode)
    if (moneyVal && typeof moneyVal === "object" && moneyVal.currencyCode) {
      result.currency = result.currency || moneyVal.currencyCode;
    }

    if (typeLower === "supplier_name" || typeLower === "vendor_name") {
      result.vendorName = result.vendorName || value;
      continue;
    }

    if (typeLower === "supplier_address") {
      result.vendorAddress = result.vendorAddress || value;
      continue;
    }

    if (typeLower === "supplier_tax_id" || typeLower === "vat_id" || typeLower === "gst_id") {
      result.vendorGst = result.vendorGst || value;
      continue;
    }

    if (typeLower === "supplier_phone") {
      result.vendorPhone = result.vendorPhone || value;
      continue;
    }

    if (typeLower === "invoice_id" || typeLower === "invoice_number") {
      result.invoiceNumber = result.invoiceNumber || value;
      continue;
    }

    if (typeLower === "invoice_date") {
      result.invoiceDate = result.invoiceDate || value;
      continue;
    }

    if (typeLower === "due_date") {
      result.dueDate = result.dueDate || value;
      continue;
    }

    if (
      typeLower === "purchase_order" ||
      typeLower === "purchase_order_number" ||
      typeLower === "purchase_order_id"
    ) {
      result.purchaseOrderNumber = result.purchaseOrderNumber || value;
      continue;
    }

    if (typeLower === "net_amount" || typeLower === "subtotal") {
      result.netAmount = result.netAmount || value;
      result.subtotal = result.subtotal || value;
      continue;
    }

    if (
      typeLower === "total_tax_amount" ||
      typeLower === "total_tax" ||
      typeLower === "tax_amount"
    ) {
      result.totalTax = result.totalTax || value;
      continue;
    }

    if (typeLower === "total_amount" || typeLower === "invoice_total") {
      result.totalAmount = result.totalAmount || value;
      continue;
    }

    if (typeLower === "currency") {
      result.currency = result.currency || value;
      continue;
    }

    if (typeLower === "line_item" || typeLower.startsWith("line_item/")) {
      result.lineItems.push(extractLineItem(entity));
    }
  }

  return result;
}

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let PDFParseClass = null;
try {
  const pdfParsePkg = require("pdf-parse");
  PDFParseClass = pdfParsePkg.PDFParse || pdfParsePkg.default || pdfParsePkg;
} catch (e) {
  console.warn("pdf-parse module not loaded; falling back to text extraction.", e?.message);
}

/**
 * Strict Invoice Document Detection & Scoring Engine
 * Checks text and extracted data for required invoice structure and evidence keywords.
 * Includes multi-currency and international invoice signals.
 */
export function detectInvoiceDocument(fileContent = "", extractedData = {}) {
  const textLower = String(fileContent || "").toLowerCase();

  // 1. Keyword Evidence Score — includes international invoice keywords
  const invoiceKeywords = [
    "invoice", "tax invoice", "bill of supply", "bill to", "gstin", "gst no",
    "invoice no", "invoice number", "invoice date", "subtotal", "grand total",
    "total amount", "line total", "unit price", "due date", "po number",
    "purchase order", "tax amount", "cgst", "sgst", "igst", "vendor", "supplier",
    "amount in words", "hsn", "sac",
    // International / multi-currency signals
    "vat", "sales tax", "receipt", "bill", "statement",
    "payment due", "invoice total", "remit to", "account number",
    "usd", "eur", "gbp", "aed", "inr", "cad", "aud", "jpy", "cny",
    "qty", "quantity", "description", "item", "amount",
  ];

  let keywordMatches = 0;
  invoiceKeywords.forEach((kw) => {
    if (textLower.includes(kw)) keywordMatches++;
  });

  let evidenceScore = keywordMatches * 4; // each keyword = 4 points, ~96 max

  // 2. Field / Structural Evidence
  const hasInvoiceNumber = Boolean(extractedData.invoiceNumber);
  const hasVendorName = Boolean(extractedData.vendorName);
  const hasGstin = Boolean(extractedData.vendorGst);
  const hasInvoiceDate = Boolean(extractedData.invoiceDate);
  const hasLineItems = Array.isArray(extractedData.lineItems) && extractedData.lineItems.length > 0;
  const hasSubtotal = extractedData.subtotal !== null && extractedData.subtotal !== undefined && extractedData.subtotal > 0;
  const hasTotal = extractedData.totalAmount !== null && extractedData.totalAmount !== undefined && extractedData.totalAmount > 0;

  if (hasInvoiceNumber) evidenceScore += 15;
  if (hasVendorName) evidenceScore += 15;
  if (hasGstin) evidenceScore += 10;
  if (hasInvoiceDate) evidenceScore += 10;
  if (hasLineItems) evidenceScore += 15;
  if (hasSubtotal || hasTotal) evidenceScore += 15;

  // 3. Mandatory Invoice Criteria Check
  const containsInvoiceKeyword =
    textLower.includes("invoice") ||
    textLower.includes("bill") ||
    textLower.includes("tax invoice") ||
    textLower.includes("receipt");
  const structuralCount =
    (hasInvoiceNumber ? 1 : 0) +
    (hasVendorName ? 1 : 0) +
    (hasLineItems ? 1 : 0) +
    (hasSubtotal || hasTotal ? 1 : 0);

  const isInvoice = evidenceScore >= 35 && (containsInvoiceKeyword || structuralCount >= 2);

  const missingDetails = [];
  if (!containsInvoiceKeyword) missingDetails.push("Invoice / Tax Invoice / Bill keyword not detected.");
  if (!hasInvoiceNumber) missingDetails.push("Invoice number not detected.");
  if (!hasVendorName) missingDetails.push("Vendor / Supplier information not detected.");
  if (!hasLineItems) missingDetails.push("Invoice line items not detected.");
  if (!hasSubtotal && !hasTotal) missingDetails.push("Billing totals not detected.");

  return { isInvoice, evidenceScore, missingDetails };
}

/**
 * Detects currency from raw text for the fallback parser.
 * Returns an ISO 4217 code or null (never guesses blindly).
 */
function detectCurrencyFromText(text) {
  if (!text) return null;

  // Explicit ISO codes take priority
  const isoCodes = ["USD", "EUR", "GBP", "AED", "CAD", "AUD", "JPY", "CNY", "CHF",
    "SGD", "HKD", "NZD", "SEK", "NOK", "DKK", "PLN", "SAR", "QAR",
    "KRW", "MYR", "THB", "IDR", "ZAR", "INR", "MXN", "BRL"];

  for (const code of isoCodes) {
    if (new RegExp(`\\b${code}\\b`, "i").test(text)) return code;
  }

  // GSTIN → INR
  if (/\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/i.test(text)) return "INR";

  // Unambiguous symbols
  if (/₹/.test(text)) return "INR";
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  if (/₩/.test(text)) return "KRW";
  if (/฿/.test(text)) return "THB";

  // Don't guess $ or ¥ — return null to trigger NEEDS_REVIEW
  return null;
}

/**
 * Intelligent Local Parser for document text extraction when GCP Document AI
 * API returns billing/permission error or is unreachable.
 * NEVER invents fake data. Currency detection uses text signals.
 */
async function fallbackExtract(filePath, fileName) {
  let fileContent = "";
  const ext = path.extname(fileName || filePath).toLowerCase();

  if (ext === ".pdf") {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      if (PDFParseClass && typeof PDFParseClass === "function") {
        const parser = new PDFParseClass({ data: fileBuffer });
        await parser.load();
        const res = await parser.getText();
        fileContent = res.text || "";
      }
    } catch (e) {
      console.warn("Could not parse PDF text via pdf-parse:", e?.message);
    }
  }

  if (!fileContent) {
    try {
      fileContent = fs.readFileSync(filePath, "utf-8").toString();
    } catch (e) {
      fileContent = "";
    }
  }

  // 1. Invoice Number Extraction
  const invMatch =
    fileContent.match(/Invoice\s*(?:Number|No\.?|Num\.?|ID)\s*[:=]?\s*([A-Z0-9-_]+)/i) ||
    fileContent.match(/\b(INV-[A-Z0-9-_]+)\b/i) ||
    fileContent.match(/(?:Invoice|INV)\s*[:=]?\s*([A-Z0-9-_]{3,})/i);
  const invNum = invMatch ? invMatch[1].trim().toUpperCase() : null;

  // 2. Vendor Name Extraction
  let vendorName = null;
  const vendorMatch = fileContent.match(/(?:Vendor|Supplier|From|Billed By|Sold By)\s*[:=]?\s*([^\n\r]+)/i);
  if (vendorMatch && vendorMatch[1].trim().length > 2) {
    vendorName = vendorMatch[1].trim();
  }

  // 3. GSTIN Extraction
  const gstMatch =
    fileContent.match(/GSTIN\s*[:=]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i) ||
    fileContent.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/i);
  const vendorGst = gstMatch ? (gstMatch[1] || gstMatch[0]).toUpperCase() : null;

  // 4. Date Extraction
  const dateMatch = fileContent.match(/(?:Date|Invoice Date)\s*[:=]?\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4})/i);
  const invoiceDate = dateMatch ? dateMatch[1] : null;

  // 5. Line Items Extraction
  const lineItems = [];
  const lineRegex = /(Item\s*\d+|[A-Za-z0-9\s]{3,30}?)\s*[:|-]?\s*(\d+(?:\.\d+)?)\s*(?:[xX×]|@)\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)\s*=\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/gi;

  let match;
  let itemIdx = 1;
  while ((match = lineRegex.exec(fileContent)) !== null) {
    const desc = match[1].trim();
    const qty = parseFloat(match[2]);
    const unitPrice = parseFloat(match[3].replace(/,/g, ""));
    const amount = parseFloat(match[4].replace(/,/g, ""));

    lineItems.push({
      description: desc || `Item ${itemIdx}`,
      quantity: qty,
      unitPrice: unitPrice,
      amount: amount,
      raw: match[0],
    });
    itemIdx++;
  }

  if (lineItems.length === 0) {
    const lines = fileContent.split(/\r?\n/);
    for (const line of lines) {
      const simpleMatch = line.match(/(Item\s*\d+|[A-Za-z0-9\s]{3,30})\s+(\d+)\s+([₹$€£\d,.]+)\s+([₹$€£\d,.]+)/i);
      if (simpleMatch) {
        const qty = parseFloat(simpleMatch[2]);
        const price = parseFloat(simpleMatch[3].replace(/[^0-9.]/g, ""));
        const total = parseFloat(simpleMatch[4].replace(/[^0-9.]/g, ""));
        if (qty > 0 && price > 0) {
          lineItems.push({
            description: simpleMatch[1].trim(),
            quantity: qty,
            unitPrice: price,
            amount: total || qty * price,
            raw: line.trim(),
          });
        }
      }
    }
  }

  // 6. Subtotal Extraction
  const subtotalMatch = fileContent.match(/Subtotal\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i);
  let subtotal = subtotalMatch ? parseFloat(subtotalMatch[1].replace(/,/g, "")) : null;
  if (subtotal === null && lineItems.length > 0) {
    subtotal = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  }

  // 7. Tax Extraction (supports GST, VAT, Sales Tax)
  const taxMatch =
    fileContent.match(/(?:Total\s*Tax|Tax\s*Amount|GST\s*\(\d+%\)|GST\s*:|VAT\s*:|Sales\s*Tax\s*:)\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i) ||
    fileContent.match(/^\s*(?:GST|Tax|CGST|SGST|IGST|VAT|Sales Tax)\s*(?:\([^)]*\))?\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/im);
  let totalTax = taxMatch ? parseFloat(taxMatch[1].replace(/,/g, "")) : null;

  const taxRateMatch = fileContent.match(/(?:GST|Tax|VAT)\s*[:=]?\s*(\d+(?:\.\d+)?)%/i) || fileContent.match(/(\d+)%\s*(?:GST|Tax|VAT)/i);
  const taxRate = taxRateMatch ? parseFloat(taxRateMatch[1]) : null; // null = not detected (don't assume 18%)

  if (totalTax === null && subtotal !== null && subtotal > 0 && taxRate !== null) {
    totalTax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  }

  // 8. Declared Grand Total Extraction
  const grandMatch = fileContent.match(/Grand\s*Total\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i) ||
    fileContent.match(/Total\s*(?:Amount\s*)?Due\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i) ||
    fileContent.match(/Amount\s*(?:Payable|Due)\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i);
  let totalAmount = grandMatch ? parseFloat(grandMatch[1].replace(/,/g, "")) : null;
  if (totalAmount === null && subtotal !== null) {
    totalAmount = subtotal + (totalTax || 0);
  }

  // 9. Currency Detection (never defaults to INR blindly)
  const detectedCurrency = detectCurrencyFromText(fileContent);

  const extractedData = {
    vendorName,
    vendorAddress: null,
    vendorPhone: null,
    vendorGst,
    invoiceNumber: invNum,
    invoiceDate,
    dueDate: null,
    purchaseOrderNumber: null,
    subtotal,
    netAmount: subtotal,
    totalTax,
    taxRate,
    totalAmount,
    grandTotal: totalAmount,
    currency: detectedCurrency, // null if ambiguous — currency service will handle NEEDS_REVIEW
    lineItems,
    rawEntities: [],
  };

  const detectionResult = detectInvoiceDocument(fileContent, extractedData);

  return {
    text: fileContent.slice(0, 2000),
    pages: 1,
    extractedData,
    detectionResult,
    processor: {
      projectId: env.documentAi.projectId || "local-fallback",
      location: env.documentAi.location || "us",
      processorId: env.documentAi.processorId || "local",
      name: "Fallback Document Parser (pdf-parse)",
    },
    fallbackUsed: true,
  };
}

export async function processInvoiceFile(filePath, mimeType, originalFilename = "") {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Invoice file not found: ${absolutePath}`);
  }

  const fileBuffer = fs.readFileSync(absolutePath);

  if (!fileBuffer.length) {
    throw new Error("Invoice file is empty.");
  }

  const processorName = getProcessorName();

  console.log("========================================");
  console.log("DOCUMENT AI PROCESSING");
  console.log("Processor:", processorName);
  console.log("MIME type:", mimeType);
  console.log("File size:", fileBuffer.length, "bytes");
  console.log("========================================");

  const request = {
    name: processorName,
    rawDocument: {
      content: fileBuffer,
      mimeType,
    },
  };

  try {
    const [result] = await client.processDocument(request);

    if (result?.document) {
      const document = result.document;
      const extractedData = extractEntities(document);
      const detectionResult = detectInvoiceDocument(document.text || "", extractedData);

      console.log(`✅ Document AI processing successful Pages: ${document.pages?.length || 0} Entities found: ${document.entities?.length || 0} Vendor: ${extractedData.vendorName || "N/A"} Invoice Number: ${extractedData.invoiceNumber || "N/A"} Currency: ${extractedData.currency || "Not detected"} Total: ${extractedData.totalAmount || 0}`);

      return {
        text: document.text || "",
        pages: document.pages?.length || 0,
        extractedData,
        detectionResult,
        processor: {
          projectId: env.documentAi.projectId,
          location: env.documentAi.location,
          processorId: env.documentAi.processorId,
          name: processorName,
        },
        fallbackUsed: false,
      };
    }
  } catch (error) {
    console.warn("===== DOCUMENT AI WARNING (Using Fallback Parser) =====");
    console.warn("Code:", error?.code);
    console.warn("Message:", error?.message);
    console.warn("Falling back to local intelligent document parser.");
    console.warn("=======================================================");

    return fallbackExtract(absolutePath, originalFilename || path.basename(filePath));
  }

  return fallbackExtract(absolutePath, originalFilename || path.basename(filePath));
}