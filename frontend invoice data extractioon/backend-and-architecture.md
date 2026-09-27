> **Note:** This was the original planning doc (GCP/PostgreSQL-flavored). The
> actual Phase 2 implementation uses local disk storage + MySQL (later phase)
> per the updated project spec — see `../README.md` for what's actually built
> and the real setup steps. Keeping this file for the validation-rule and
> Document AI integration notes, which are still accurate.

# InvoiceFlow — Backend, Database & Cloud Architecture

The dashboard artifact is the frontend, running on realistic demo data. This doc is the
spec for the real backend behind it — everything needed to wire it up to a live
pipeline later.

## Architecture

```
Frontend (React/TS)
   ↓  HTTPS + JWT
Backend API (Node.js + Express)
   ↓
Cloud Storage (GCS bucket, signed URLs)
   ↓
Google Cloud Document AI — Invoice Parser
   ↓
Validation Engine (business rules, see below)
   ↓
Duplicate Detection (fuzzy match on invoice #, vendor, date, amount)
   ↓
Cloud Database (PostgreSQL, Cloud SQL)
   ↓
Dashboard (reads via REST/GraphQL)
```

All Document AI and cloud credentials live in backend environment variables
(`GOOGLE_APPLICATION_CREDENTIALS`, `DB_URL`, etc.) — never shipped to the frontend.

## Database schema (PostgreSQL)

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  vendor_gst TEXT,
  invoice_date DATE NOT NULL,
  due_date DATE,
  subtotal NUMERIC(14,2) NOT NULL,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'processing',       -- valid | pending | duplicate | error | processing
  validation_status TEXT NOT NULL DEFAULT 'pending',
  duplicate_status TEXT,
  extraction_confidence NUMERIC(5,4),
  file_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL
);

CREATE TABLE validation_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  error_type TEXT NOT NULL,        -- Missing Information | Calculation Errors | Format Errors
  error_message TEXT NOT NULL,
  severity TEXT NOT NULL,          -- error | warning
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE processing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,             -- uploaded | ocr | extraction | validation | duplicate | completed
  status TEXT NOT NULL,            -- started | success | failed
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Core API endpoints

```
POST   /api/invoices/upload          → uploads file to GCS, kicks off pipeline, returns invoice id
GET    /api/invoices                 → list + filter + paginate
GET    /api/invoices/:id             → full extracted data + validation + duplicate info
PATCH  /api/invoices/:id             → correct fields during human review
POST   /api/invoices/:id/approve
POST   /api/invoices/:id/reject
POST   /api/invoices/:id/mark-duplicate
POST   /api/invoices/:id/not-duplicate
GET    /api/analytics/summary        → KPI + chart data
```

## Validation engine (business rules)

```
required fields present (invoice #, vendor, date, total)
quantity × unit price == line total
sum(line totals) == subtotal
subtotal + tax − discount == grand total
GST/VAT number matches format regex for the declared country
currency is in the supported list
invoice date <= due date
```

## Duplicate detection

Score a candidate against existing invoices on: exact invoice number match,
vendor name similarity (trigram/fuzzy), invoice date match, amount match
(within a small tolerance). Combine into a confidence score (0–100%); anything
above the configurable threshold (see Settings page, default 95%) is flagged
for review rather than auto-rejected.

## Document AI integration

```js
const [result] = await documentAIClient.processDocument({
  name: `projects/${projectId}/locations/${location}/processors/${processorId}`,
  rawDocument: { content: fileBuffer.toString("base64"), mimeType: "application/pdf" },
});
// result.document.entities → map Document AI's invoice entity types
// (invoice_id, supplier_name, total_amount, etc.) into the invoices table
```

Do not train a custom model — Document AI's pretrained Invoice Parser (or
Textract / Form Recognizer as swappable alternatives) covers the extraction.
