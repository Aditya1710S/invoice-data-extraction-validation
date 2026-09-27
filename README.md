# InvoiceFlow — Setup & Phase 2 Status

This folder contains:

```
frontend invoice data extractioon/
  invoiceflow/     — React + Vite + Tailwind dashboard (existing, now wired to the real API)
  backend/         — Node.js + Express backend (new, Phase 2)
  backend-and-architecture.md  — original planning notes (superseded by this README + the spec you gave)
```

## What's real right now (Phase 2)

- Uploading a file from the dashboard sends it to the Express backend over HTTP.
- The backend validates file type (`pdf`, `jpg`, `jpeg`, `png`) and size (20MB default), stores it on local disk under a random UUID filename (never the original filename — prevents path traversal), and computes a SHA-256 hash.
- **Exact-file duplicate detection is real**: if the same bytes are uploaded twice, the second one is flagged `DUPLICATE_FILE` with a reference to the original.
- `GET /api/invoices`, `GET /api/invoices/:id`, and `GET /api/dashboard/stats` return real data from what's been uploaded — currently stored in a JSON file (`backend/src/data/db.json`), which stands in for MySQL until Phase 3.

## What's NOT real yet (by design — see roadmap below)

- No OCR / Document AI extraction — uploaded files are stored but not read.
- No validation engine (calculation checks, GST checks, etc.) — not implemented yet, so nothing is labeled `VALID`/`REVIEW`/`INVALID`.
- No MySQL — the JSON file store is a placeholder with the same read/write interface a real DB layer will have, so swapping it later won't touch route or controller code.
- No human review workflow — the dashboard's other pages (All Invoices, Errors, Duplicates, Analytics) still show the original 24 seeded demo invoices from `INVOICES` in `InvoiceDashboard.jsx`. Only the **Upload** page is wired to the real backend so far.

## Running it locally

### 1. Backend

```bash
cd "frontend invoice data extractioon/backend"
npm install
cp .env.example .env
npm run dev
```

Starts on `http://localhost:4000`. Check it's alive:

```bash
curl http://localhost:4000/api/health
```

You'll see a console warning that Document AI isn't configured — expected until Phase 3.

### 2. Frontend

```bash
cd "frontend invoice data extractioon/invoiceflow"
npm install
npm run dev
```

Starts on `http://localhost:5173` (Vite default). Go to the **Upload Invoice** page and drop a real PDF or image — it will actually upload, hash, and store the file, and show you the real backend response.

If your backend runs somewhere other than `http://localhost:4000`, set `VITE_API_BASE_URL` in a `.env` file inside `invoiceflow/` (e.g. `VITE_API_BASE_URL=http://localhost:4000/api`).

### 3. Try duplicate detection

Upload the same file twice (or two files with identical content) — the second one will come back marked as a duplicate with a reference to the first.

## Roadmap — what happens in each remaining phase

| Phase | Scope |
|---|---|
| **3** | Google Cloud Document AI integration — real OCR extraction into the fields your spec defines (vendor, GSTIN, invoice #, line items, etc.). Requires a GCP project, a Document AI Invoice Parser processor, and a service account key — see below. |
| **4** | Validation engine — line-item math, GST/tax math (CGST+SGST or IGST, not hardcoded to 18%), grand total, date checks, vendor master-data checks, business-level duplicate detection (invoice number + vendor, not just file hash). |
| **5** | MySQL — replace `jsonStore.js` with a real `mysql2` connection pool and the schema (`users`, `vendors`, `invoices`, `invoice_items`, `validation_results`, `validation_errors`, `review_history`, `processing_logs`). |
| **6** | Human Review page — PDF preview + editable extracted fields + Save Correction / Re-validate / Approve / Reject, wired to the dashboard's existing `ReviewModal` UI. |
| **7** | Wire the rest of the dashboard (All Invoices, Errors, Duplicates, Analytics, dashboard KPIs) to the real API instead of the seeded demo data, and retire `INVOICES`/`buildInvoice()` from `InvoiceDashboard.jsx`. |
| **8** (optional, later) | BullMQ/Redis queue for async processing instead of the current sequential bulk-upload loop. |

### Setting up Document AI for Phase 3 (when you're ready)

1. Create a GCP project (or use an existing one) and enable the **Document AI API**.
2. Create an **Invoice Parser** processor in Document AI, note its Processor ID and region.
3. Create a service account with the `Document AI API User` role, download its JSON key.
4. In `backend/.env`, set `GOOGLE_APPLICATION_CREDENTIALS` (path to that key file), `GCP_PROJECT_ID`, `GCP_LOCATION`, and `DOCUMENT_AI_PROCESSOR_ID`.
5. Never commit the key file or put it in the frontend — `backend/.gitignore` already excludes `gcp-service-account.json`.

Let me know when you want to move on to Phase 3 and I'll build the Document AI integration against these same upload records.
