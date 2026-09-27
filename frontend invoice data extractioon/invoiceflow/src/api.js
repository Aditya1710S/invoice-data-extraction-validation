export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api";

// ─── Upload ────────────────────────────────────────────────────────────────────

/**
 * Single invoice upload — returns the full invoice record.
 * Bulk upload (>1 file) returns batchId immediately for async polling.
 */
export function uploadInvoices(files, onProgress) {
  return new Promise((resolve, reject) => {
    if (!files || files.length === 0) {
      reject(new Error("No files selected."));
      return;
    }
    const isBulk = files.length > 1;
    const endpoint = isBulk ? "invoices/bulk-upload" : "invoices/upload";
    const formData = new FormData();
    files.forEach((f) => formData.append(isBulk ? "invoices" : "invoice", f));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/${endpoint}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve({ isBulk, body });
      } else {
        reject(new Error(body?.error || `Upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => {
      reject(new Error(`Could not reach backend at ${API_BASE_URL}. Is the server running?`));
    };
    xhr.send(formData);
  });
}

// ─── Invoice List & Detail ─────────────────────────────────────────────────────

export async function fetchInvoices(params = {}) {
  // Remove empty/falsy params so they don't pollute the query string
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
  const qs = new URLSearchParams(clean).toString();
  const res = await fetch(`${API_BASE_URL}/invoices${qs ? `?${qs}` : ""}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to load invoices.");
  return body;
}

export async function fetchDashboardStats() {
  const res = await fetch(`${API_BASE_URL}/dashboard/stats`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to load dashboard stats.");
  return body;
}

// ─── Invoice Actions ───────────────────────────────────────────────────────────

export async function approveInvoiceApi(id) {
  const res = await fetch(`${API_BASE_URL}/invoices/${id}/approve`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to approve invoice.");
  return body;
}

export async function rejectInvoiceApi(id) {
  const res = await fetch(`${API_BASE_URL}/invoices/${id}/reject`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to reject invoice.");
  return body;
}

export async function updateInvoiceApi(id, patch) {
  const res = await fetch(`${API_BASE_URL}/invoices/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to update invoice.");
  return body;
}

export async function deleteInvoiceApi(id) {
  const res = await fetch(`${API_BASE_URL}/invoices/${id}`, { method: "DELETE" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to delete invoice.");
  return body;
}

// ─── File & Report URLs ────────────────────────────────────────────────────────

export function getInvoiceFileUrl(id) {
  return `${API_BASE_URL}/invoices/${id}/file`;
}

export function getInvoiceReportPdfUrl(id) {
  return `${API_BASE_URL}/invoices/${id}/report/pdf`;
}

export function getInvoiceReportExcelUrl(id) {
  return `${API_BASE_URL}/invoices/${id}/report/excel`;
}

export function getInvoiceReportJsonUrl(id) {
  return `${API_BASE_URL}/invoices/${id}/report`;
}

// ─── Bulk Batch ────────────────────────────────────────────────────────────────

export async function fetchBatchStatus(batchId) {
  const res = await fetch(`${API_BASE_URL}/invoices/batch/${batchId}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch batch status.");
  return body; // { batch: { batchId, status, total, processed, valid, invalid, progress, results } }
}

export async function cancelBatchApi(batchId) {
  const res = await fetch(`${API_BASE_URL}/invoices/batch/${batchId}/cancel`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to cancel batch.");
  return body;
}

export function getBatchReportExcelUrl(batchId) {
  return `${API_BASE_URL}/invoices/batch/${batchId}/report/excel`;
}

// ─── Currencies ────────────────────────────────────────────────────────────────

export async function fetchSupportedCurrencies() {
  const res = await fetch(`${API_BASE_URL}/invoices/currencies`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to load currencies.");
  return body; // { currencies: [{ code, symbol, name }] }
}

// ─── Notifications ─────────────────────────────────────────────────────────────

export async function fetchNotifications() {
  const res = await fetch(`${API_BASE_URL}/notifications`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to load notifications.");
  return body; // { notifications: [...], unreadCount: N }
}

export async function markNotificationReadApi(id) {
  const res = await fetch(`${API_BASE_URL}/notifications/${id}/read`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to mark notification as read.");
  return body;
}

export async function markAllNotificationsReadApi() {
  const res = await fetch(`${API_BASE_URL}/notifications/read-all`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to mark all notifications as read.");
  return body;
}
