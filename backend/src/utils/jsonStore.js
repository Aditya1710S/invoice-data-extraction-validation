import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.resolve(__dirname, "../data/db.json");

let writeQueue = Promise.resolve();

const SEED_INVOICES = [
  {
    id: "inv-1001",
    originalFilename: "Meridian_Steel_INV-1001.pdf",
    storedFilename: "seed-1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 15420,
    fileHash: "hash-seed-1",
    status: "VALID",
    isDuplicateFile: false,
    duplicateOfId: null,
    extractedData: {
      vendorName: "Meridian Steel Supply Co.",
      vendorAddress: "Plot 14, Industrial Estate, Pune, MH 411019",
      vendorPhone: "+91 9810012345",
      vendorGst: "27AABCM1234F1Z5",
      invoiceNumber: "INV-1001",
      invoiceDate: "2026-08-02",
      dueDate: "2026-09-01",
      purchaseOrderNumber: "PO-2026003",
      subtotal: 9600,
      totalTax: 1728,
      discount: 0,
      totalAmount: 11328,
      currency: "INR",
      lineItems: [
        { description: "Structural Beam Unit", quantity: 4, unitPrice: 2400, amount: 9600 }
      ]
    },
    vendor: { name: "Meridian Steel Supply Co.", gst: "27AABCM1234F1Z5", address: "Plot 14, Industrial Estate, Pune, MH 411019", email: "accounts@meridian.com", phone: "+91 9810012345" },
    invoiceNumber: "INV-1001",
    invoiceDate: "2026-08-02",
    dueDate: "2026-09-01",
    poNumber: "PO-2026003",
    currency: "INR",
    subtotal: 9600,
    tax: 1728,
    discount: 0,
    total: 11328,
    expectedTotal: 11328,
    items: [{ id: 0, name: "Structural Beam Unit", qty: 4, price: 2400, tax: 1728, total: 11328 }],
    confidence: 0.98,
    validationErrors: [],
    uploadedAt: "2026-08-02T10:15:00.000Z",
    updatedAt: "2026-08-02T10:15:00.000Z",
    processingLogs: [{ stage: "uploaded", status: "success", message: "Initial seed invoice.", timestamp: "2026-08-02T10:15:00.000Z" }]
  },
  {
    id: "inv-1002",
    originalFilename: "Northgate_INV-1002.pdf",
    storedFilename: "seed-2.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12840,
    fileHash: "hash-seed-2",
    status: "VALID",
    isDuplicateFile: false,
    duplicateOfId: null,
    extractedData: {
      vendorName: "Northgate Office Solutions",
      vendorAddress: "4th Floor, Whitefield Rd, Bengaluru, KA 560066",
      vendorPhone: "+91 9820012346",
      vendorGst: "29AACFN5678K2Z1",
      invoiceNumber: "INV-1002",
      invoiceDate: "2026-08-04",
      dueDate: "2026-09-03",
      purchaseOrderNumber: "PO-2026006",
      subtotal: 4500,
      totalTax: 810,
      discount: 0,
      totalAmount: 5310,
      currency: "INR",
      lineItems: [
        { description: "A4 Copier Paper (Ream)", quantity: 10, unitPrice: 450, amount: 4500 }
      ]
    },
    vendor: { name: "Northgate Office Solutions", gst: "29AACFN5678K2Z1", address: "4th Floor, Whitefield Rd, Bengaluru, KA 560066", email: "accounts@northgate.com", phone: "+91 9820012346" },
    invoiceNumber: "INV-1002",
    invoiceDate: "2026-08-04",
    dueDate: "2026-09-03",
    poNumber: "PO-2026006",
    currency: "INR",
    subtotal: 4500,
    tax: 810,
    discount: 0,
    total: 5310,
    expectedTotal: 5310,
    items: [{ id: 0, name: "A4 Copier Paper (Ream)", qty: 10, price: 450, tax: 810, total: 5310 }],
    confidence: 0.95,
    validationErrors: [],
    uploadedAt: "2026-08-04T11:20:00.000Z",
    updatedAt: "2026-08-04T11:20:00.000Z",
    processingLogs: [{ stage: "uploaded", status: "success", message: "Initial seed invoice.", timestamp: "2026-08-04T11:20:00.000Z" }]
  },
  {
    id: "inv-1003",
    originalFilename: "Ashford_INV-1003.pdf",
    storedFilename: "seed-3.pdf",
    mimeType: "application/pdf",
    sizeBytes: 18900,
    fileHash: "hash-seed-3",
    status: "ERROR",
    isDuplicateFile: false,
    duplicateOfId: null,
    extractedData: {
      vendorName: "Ashford Freight & Logistics",
      vendorAddress: "Sector 9, GIDC, Ahmedabad, GJ 380009",
      vendorPhone: "+91 9830012347",
      vendorGst: "24AAECA9081H1ZC",
      invoiceNumber: "INV-1003",
      invoiceDate: "2026-08-05",
      dueDate: "2026-09-04",
      purchaseOrderNumber: "PO-2026009",
      subtotal: 6000,
      totalTax: 1080,
      discount: 0,
      totalAmount: 8080, // force error: should be 7080
      currency: "INR",
      lineItems: [
        { description: "Freight Handling Fee", quantity: 2, unitPrice: 3000, amount: 6000 }
      ]
    },
    vendor: { name: "Ashford Freight & Logistics", gst: "24AAECA9081H1ZC", address: "Sector 9, GIDC, Ahmedabad, GJ 380009", email: "accounts@ashford.com", phone: "+91 9830012347" },
    invoiceNumber: "INV-1003",
    invoiceDate: "2026-08-05",
    dueDate: "2026-09-04",
    poNumber: "PO-2026009",
    currency: "INR",
    subtotal: 6000,
    tax: 1080,
    discount: 0,
    total: 8080,
    expectedTotal: 7080,
    items: [{ id: 0, name: "Freight Handling Fee", qty: 2, price: 3000, tax: 1080, total: 8080 }],
    confidence: 0.92,
    validationErrors: [
      { type: "Calculation Errors", message: "Grand total mismatch — expected ₹7,080, invoice states ₹8,080", severity: "error", expected: 7080, actual: 8080 }
    ],
    uploadedAt: "2026-08-05T14:30:00.000Z",
    updatedAt: "2026-08-05T14:30:00.000Z",
    processingLogs: [{ stage: "uploaded", status: "success", message: "Initial seed invoice.", timestamp: "2026-08-05T14:30:00.000Z" }]
  },
  {
    id: "inv-1004",
    originalFilename: "Kavali_INV-1004.pdf",
    storedFilename: "seed-4.pdf",
    mimeType: "application/pdf",
    sizeBytes: 14200,
    fileHash: "hash-seed-4",
    status: "ERROR",
    isDuplicateFile: false,
    duplicateOfId: null,
    extractedData: {
      vendorName: "Kavali Electronics Pvt Ltd",
      vendorAddress: "HITEC City, Hyderabad, TG 500081",
      vendorPhone: "+91 9840012348",
      vendorGst: null, // missing GST
      invoiceNumber: "INV-1004",
      invoiceDate: "2026-08-07",
      dueDate: "2026-09-06",
      purchaseOrderNumber: "PO-2026012",
      subtotal: 4000,
      totalTax: 720,
      discount: 0,
      totalAmount: 4720,
      currency: "INR",
      lineItems: [
        { description: "USB-C Dock Station", quantity: 5, unitPrice: 800, amount: 4000 }
      ]
    },
    vendor: { name: "Kavali Electronics Pvt Ltd", gst: null, address: "HITEC City, Hyderabad, TG 500081", email: "accounts@kavali.com", phone: "+91 9840012348" },
    invoiceNumber: "INV-1004",
    invoiceDate: "2026-08-07",
    dueDate: "2026-09-06",
    poNumber: "PO-2026012",
    currency: "INR",
    subtotal: 4000,
    tax: 720,
    discount: 0,
    total: 4720,
    expectedTotal: 4720,
    items: [{ id: 0, name: "USB-C Dock Station", qty: 5, price: 800, tax: 720, total: 4720 }],
    confidence: 0.89,
    validationErrors: [
      { type: "Format Errors", message: "Missing or invalid GST/VAT number for vendor.", severity: "error" }
    ],
    uploadedAt: "2026-08-07T09:45:00.000Z",
    updatedAt: "2026-08-07T09:45:00.000Z",
    processingLogs: [{ stage: "uploaded", status: "success", message: "Initial seed invoice.", timestamp: "2026-08-07T09:45:00.000Z" }]
  }
];

function readRaw() {
  if (!fs.existsSync(DB_FILE)) {
    writeRaw({ invoices: SEED_INVOICES });
    return { invoices: SEED_INVOICES };
  }
  const raw = fs.readFileSync(DB_FILE, "utf-8").trim();
  if (!raw) {
    writeRaw({ invoices: SEED_INVOICES });
    return { invoices: SEED_INVOICES };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.invoices || parsed.invoices.length === 0) {
      writeRaw({ invoices: SEED_INVOICES });
      return { invoices: SEED_INVOICES };
    }
    return parsed;
  } catch {
    writeRaw({ invoices: SEED_INVOICES });
    return { invoices: SEED_INVOICES };
  }
}

function writeRaw(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function enqueueWrite(mutator) {
  writeQueue = writeQueue.then(() => {
    const data = readRaw();
    const result = mutator(data);
    writeRaw(data);
    return result;
  });
  return writeQueue;
}

export function listInvoices() {
  return readRaw().invoices;
}

export function getInvoiceById(id) {
  return readRaw().invoices.find((inv) => inv.id === id) || null;
}

export function findInvoiceByFileHash(fileHash) {
  return readRaw().invoices.find((inv) => inv.fileHash === fileHash) || null;
}

export function insertInvoice(record) {
  return enqueueWrite((data) => {
    data.invoices.push(record);
    return record;
  });
}

export function updateInvoice(id, patch) {
  return enqueueWrite((data) => {
    const idx = data.invoices.findIndex((inv) => inv.id === id);
    if (idx === -1) return null;
    data.invoices[idx] = { ...data.invoices[idx], ...patch, updatedAt: new Date().toISOString() };
    return data.invoices[idx];
  });
}

export function deleteInvoice(id) {
  return enqueueWrite((data) => {
    const idx = data.invoices.findIndex((inv) => inv.id === id);
    if (idx === -1) return false;
    data.invoices.splice(idx, 1);
    return true;
  });
}

export function appendProcessingLog(id, logEntry) {
  return enqueueWrite((data) => {
    const idx = data.invoices.findIndex((inv) => inv.id === id);
    if (idx === -1) return null;
    data.invoices[idx].processingLogs = data.invoices[idx].processingLogs || [];
    data.invoices[idx].processingLogs.push(logEntry);
    return data.invoices[idx];
  });
}
