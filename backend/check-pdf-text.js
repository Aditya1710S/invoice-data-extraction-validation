import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

async function parseText(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: fileBuffer });
  await parser.load();
  const res = await parser.getText();
  const fileContent = res.text || "";

  // 1. Invoice Number Extraction
  const invMatch =
    fileContent.match(/Invoice\s*(?:Number|No\.?|Num\.?|ID)\s*[:=]?\s*([A-Z0-9-_]+)/i) ||
    fileContent.match(/\b(INV-[A-Z0-9-_]+)\b/i);
  const invNum = invMatch ? invMatch[1].trim().toUpperCase() : "INV-UNKNOWN";

  // 2. Vendor Name
  const vendorMatch = fileContent.match(/(?:Vendor|Supplier|From)\s*[:=]?\s*([^\n\r]+)/i);
  const vendorName = vendorMatch ? vendorMatch[1].trim() : "Unknown Vendor";

  // 3. GSTIN
  const gstMatch = fileContent.match(/GSTIN\s*[:=]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i) ||
                   fileContent.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/i);
  const vendorGst = gstMatch ? (gstMatch[1] || gstMatch[0]).toUpperCase() : null;

  // 4. Line Items
  const lineItems = [];
  const lineRegex = /(Item\s*\d+|[A-Za-z0-9\s]{3,30}?)\s*[:|-]?\s*(\d+(?:\.\d+)?)\s*(?:[xX×]|@)\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)\s*=\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/gi;

  let match;
  while ((match = lineRegex.exec(fileContent)) !== null) {
    lineItems.push({
      description: match[1].trim(),
      quantity: parseFloat(match[2]),
      unitPrice: parseFloat(match[3].replace(/,/g, "")),
      amount: parseFloat(match[4].replace(/,/g, "")),
    });
  }

  // 5. Subtotal
  const subMatch = fileContent.match(/Subtotal\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i);
  const subtotal = subMatch ? parseFloat(subMatch[1].replace(/,/g, "")) : 0;

  // 6. Tax / GST
  const taxMatch = fileContent.match(/(?:Total\s*Tax|Tax\s*Amount|GST\s*\(\d+%\)|GST\s*:)\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i) ||
                   fileContent.match(/^\s*(?:GST|Tax|CGST|SGST|IGST)\s*(?:\([^)]*\))?\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/im);
  const totalTax = taxMatch ? parseFloat(taxMatch[1].replace(/,/g, "")) : 0;

  // 7. Grand Total
  const grandMatch = fileContent.match(/Grand\s*Total\s*[:=]?\s*[^0-9\r\n]*([\d,]+(?:\.\d+)?)/i);
  const grandTotal = grandMatch ? parseFloat(grandMatch[1].replace(/,/g, "")) : 0;

  return {
    invNum,
    vendorName,
    vendorGst,
    lineItems,
    subtotal,
    totalTax,
    grandTotal,
  };
}

async function run() {
  console.log("VALID PDF PARSED:", await parseText("./test-valid-calc.pdf"));
  console.log("INVALID PDF PARSED:", await parseText("./test-invalid-calc.pdf"));
}

run();
