import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { processInvoiceFile } from "./src/services/documentAi.service.js";
import { validateExtractedInvoice } from "./src/services/validation.service.js";

function createPdfFile(filePath, content) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(18).text(content.title, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Vendor: ${content.vendorName}`);
    doc.text(`GSTIN: ${content.vendorGst}`);
    doc.text(`Invoice Number: ${content.invoiceNumber}`);
    doc.text(`Invoice Date: ${content.invoiceDate}`);
    doc.moveDown();

    doc.fontSize(14).text("Line Items:");
    content.lineItems.forEach((item) => {
      doc.fontSize(11).text(`${item.desc}: ${item.qty} x ₹${item.price} = ₹${item.total}`);
    });

    doc.moveDown();
    doc.fontSize(12).text(`Subtotal: ₹${content.subtotal}`);
    doc.text(`GST (${content.taxRate}%): ₹${content.tax}`);
    doc.fontSize(14).text(`Grand Total: ₹${content.grandTotal}`);

    doc.end();

    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING INVOICE CALCULATION VALIDATION TEST SUITE");
  console.log("==================================================\n");

  const validPath = path.resolve("./test-valid-calc.pdf");
  const invalidPath = path.resolve("./test-invalid-calc.pdf");

  // 1. Generate Valid Invoice PDF
  await createPdfFile(validPath, {
    title: "INVOICE (VALID CALCULATION)",
    vendorName: "Precision Dynamics Ltd",
    vendorGst: "27AAACP1234F1Z5",
    invoiceNumber: "INV-VAL-8024",
    invoiceDate: "2026-09-18",
    lineItems: [
      { desc: "Item 1", qty: 5, price: 400, total: 2000 },
      { desc: "Item 2", qty: 2, price: 1500, total: 3000 },
      { desc: "Item 3", qty: 3, price: 600, total: 1800 },
    ],
    subtotal: 6800,
    taxRate: 18,
    tax: 1224,
    grandTotal: 8024,
  });

  // 2. Generate Invalid Invoice PDF (₹8,500 declared vs ₹8,024 correct)
  await createPdfFile(invalidPath, {
    title: "INVOICE (INVALID CALCULATION)",
    vendorName: "Apex Manufacturing Solutions",
    vendorGst: "27ABCDE5678G1Z2",
    invoiceNumber: "INV-INV-8500",
    invoiceDate: "2026-09-18",
    lineItems: [
      { desc: "Item 1", qty: 5, price: 400, total: 2000 },
      { desc: "Item 2", qty: 2, price: 1500, total: 3000 },
      { desc: "Item 3", qty: 3, price: 600, total: 1800 },
    ],
    subtotal: 6800,
    taxRate: 18,
    tax: 1224,
    grandTotal: 8500, // Miscalculated by ₹476
  });

  console.log("1. TESTING VALID INVOICE (Declared ₹8,024):");
  const validExtract = await processInvoiceFile(validPath, "application/pdf", "test-valid-calc.pdf");
  const validValidation = validateExtractedInvoice(validExtract.extractedData, []);
  console.log("Extracted Data:", JSON.stringify(validExtract.extractedData, null, 2));
  console.log("Validation Result:", JSON.stringify(validValidation, null, 2));

  console.log("\n--------------------------------------------------\n");

  console.log("2. TESTING INVALID INVOICE (Declared ₹8,500 vs Correct ₹8,024):");
  const invalidExtract = await processInvoiceFile(invalidPath, "application/pdf", "test-invalid-calc.pdf");
  const invalidValidation = validateExtractedInvoice(invalidExtract.extractedData, []);
  console.log("Extracted Data:", JSON.stringify(invalidExtract.extractedData, null, 2));
  console.log("Validation Result:", JSON.stringify(invalidValidation, null, 2));

  console.log("\n==================================================");
  console.log("TEST SUMMARY:");
  console.log(`Valid Invoice Status:   ${validValidation.status} (Expected: VALID)`);
  console.log(`Invalid Invoice Status: ${invalidValidation.status} (Expected: INVALID)`);
  console.log(`Calculation Difference: ₹${invalidValidation.difference} (Expected: 476)`);
  console.log("==================================================");
}

runTests().catch(console.error);
