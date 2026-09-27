import fs from "node:fs";
import path from "node:path";

async function uploadFile(pdfPath) {
  const fileBuffer = fs.readFileSync(pdfPath);
  const blob = new Blob([fileBuffer], { type: "application/pdf" });

  const formData = new FormData();
  formData.append("invoice", blob, path.basename(pdfPath));

  const response = await fetch("http://localhost:4000/api/invoices/upload", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  return { status: response.status, data };
}

async function run() {
  console.log("==================================================");
  console.log("TESTING API UPLOADS & MYSQL PERSISTENCE");
  console.log("==================================================\n");

  console.log("1. Uploading VALID calculation PDF (test-valid-calc.pdf):");
  const validRes = await uploadFile("./test-valid-calc.pdf");
  console.log("HTTP Status:", validRes.status);
  console.log("Pipeline Status:", validRes.data.invoice?.status);
  console.log("Invoice Number:", validRes.data.invoice?.invoiceNumber);
  console.log("Subtotal:", validRes.data.invoice?.subtotal);
  console.log("Tax:", validRes.data.invoice?.tax);
  console.log("Grand Total:", validRes.data.invoice?.total);
  console.log("Expected Total:", validRes.data.invoice?.expectedTotal);
  console.log("Validation Errors:", validRes.data.invoice?.validationErrors);

  console.log("\n--------------------------------------------------\n");

  console.log("2. Uploading INVALID calculation PDF (test-invalid-calc.pdf):");
  const invalidRes = await uploadFile("./test-invalid-calc.pdf");
  console.log("HTTP Status:", invalidRes.status);
  console.log("Pipeline Status:", invalidRes.data.invoice?.status);
  console.log("Invoice Number:", invalidRes.data.invoice?.invoiceNumber);
  console.log("Subtotal:", invalidRes.data.invoice?.subtotal);
  console.log("Tax:", invalidRes.data.invoice?.tax);
  console.log("Declared Grand Total:", invalidRes.data.invoice?.total);
  console.log("Expected Total:", invalidRes.data.invoice?.expectedTotal);
  console.log("Difference:", invalidRes.data.invoice?.difference);
  console.log("Validation Errors:", JSON.stringify(invalidRes.data.invoice?.validationErrors, null, 2));

  console.log("\n==================================================");
  console.log("API TEST SUMMARY:");
  console.log("Valid Invoice Status:   ", validRes.data.invoice?.status);
  console.log("Invalid Invoice Status: ", invalidRes.data.invoice?.status);
  console.log("==================================================");
}

run().catch(console.error);
