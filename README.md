# Invoice Data Extraction and Validation Pipeline

An intelligent invoice processing system that automatically extracts structured information from PDF/image invoices and validates the extracted data before storing it in the database.

The system is designed to reduce manual invoice processing, identify calculation and data-entry errors, and provide a reliable workflow for invoice review and approval.

---

## 🚀 Features

* 📄 Upload PDF and image invoices
* 🤖 Automatic invoice data extraction using OCR / Google Document AI
* 🏢 Extract vendor information
* 🔢 Extract invoice number and purchase order number
* 📅 Extract invoice date
* 📦 Extract item details
* 🔢 Extract quantity and unit price
* 💰 Extract subtotal, tax/GST and grand total
* ✅ Automatic invoice validation
* 🧮 Line-item calculation validation
* 🧾 Subtotal and grand-total verification
* 🧮 GST/tax validation
* 🔍 Duplicate invoice detection
* 📅 Invoice date validation
* ⚠️ Missing-field detection
* 🚫 Invalid/non-invoice document detection
* 📊 Dashboard for invoice monitoring
* 🔎 Invoice search and filtering
* 🔄 Invoice refresh functionality
* 🗄️ MySQL database storage
* 👤 Human review for invalid or low-confidence invoices
* 📑 Invoice report generation
* 🔐 Environment variables for sensitive configuration

---

## 🏗️ System Workflow

```text
                Invoice Upload
                      │
                      ▼
              PDF / Image File
                      │
                      ▼
              OCR / Document AI
                      │
                      ▼
             Data Extraction
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
   Invoice Fields              Line Items
        │                           │
        └─────────────┬─────────────┘
                      ▼
               Data Validation
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   Required       Calculation    Duplicate
    Fields          Check         Check
        │             │             │
        └─────────────┼─────────────┘
                      ▼
                Validation Result
                 /           \
                /             \
               ▼               ▼
             Valid           Invalid
               │               │
               ▼               ▼
            Database       Human Review
               │
               ▼
          Dashboard / Report
```

---

## 🧠 Validation Checks

The system performs multiple validation checks after extracting invoice information.

### Required Field Validation

Checks whether important invoice fields are available:

* Vendor Name
* Invoice Number
* Invoice Date
* Invoice Items
* Quantity
* Unit Price
* Tax/GST
* Total Amount

### Calculation Validation

The system verifies:

```text
Quantity × Unit Price = Line Item Amount
```

Then:

```text
Sum of Line Items = Subtotal
```

And finally:

```text
Subtotal + Tax/GST = Grand Total
```

If the calculated amount differs from the invoice amount, the invoice is marked as invalid and sent for review.

### Duplicate Invoice Detection

The system checks whether the same invoice has already been uploaded or stored.

### Document Validation

Documents that do not contain recognizable invoice information are rejected instead of generating random invoice calculations.

---

## 🛠️ Technology Stack

### Frontend

* React.js
* Vite
* JavaScript
* Lucide React
* Recharts
* HTML5
* CSS3

### Backend

* Node.js
* Express.js
* REST API
* Multer
* CORS
* UUID
* dotenv

### AI / Document Processing

* Google Cloud Document AI
* Invoice Parser
* OCR-based document processing

### Database

* MySQL

### Development Tools

* Git
* GitHub
* Visual Studio Code
* PowerShell
* Postman / cURL

---

## 📂 Project Structure

```text
invoice-data-extraction-validation/
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   └── server.js
│   │
│   ├── uploads/
│   ├── credentials/
│   ├── package.json
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── App.jsx
│   │   └── InvoiceDashboard.jsx
│   │
│   ├── package.json
│   └── vite.config.js
│
├── .gitignore
└── README.md
```

> **Note:** `.env`, service-account credentials, and other sensitive files should never be committed to GitHub.

---

## ⚙️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Aditya1710S/invoice-data-extraction-validation.git
```

```bash
cd invoice-data-extraction-validation
```

---

## 🔧 Backend Setup

Go to the backend folder:

```bash
cd backend
```

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```env
PORT=4000
NODE_ENV=development

CORS_ORIGIN=http://localhost:5173

DB_NAME=invoiceflow
DB_USER=invoiceflow_app
DB_PASSWORD=YOUR_DATABASE_PASSWORD
DB_HOST=localhost

GOOGLE_CLOUD_PROJECT_ID=YOUR_PROJECT_ID
DOCUMENT_AI_PROCESSOR_ID=YOUR_PROCESSOR_ID
DOCUMENT_AI_LOCATION=us

GOOGLE_APPLICATION_CREDENTIALS=./credentials/invoiceflow-service-account.json
```

Start the backend:

```bash
npm run dev
```

Backend API:

```text
http://localhost:4000
```

Health check:

```text
http://localhost:4000/api/health
```

---

## 💻 Frontend Setup

Open another terminal and go to the frontend folder:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend will normally run at:

```text
http://localhost:5173
```

---

## 🗄️ Database

The project uses MySQL for storing invoice information.

Create the database:

```sql
CREATE DATABASE invoiceflow;
```

The backend initializes the required tables when configured correctly.

Make sure MySQL is running before starting the backend.

---

## ☁️ Google Document AI Configuration

The project uses Google Cloud Document AI for invoice processing.

Required configuration:

```text
Google Cloud Project
        │
        ▼
Document AI API
        │
        ▼
Invoice Parser
        │
        ▼
Processor ID
        │
        ▼
Backend
        │
        ▼
Invoice Extraction
```

The Google Cloud service-account JSON file should be stored locally and must **not** be uploaded to GitHub.

---

## 🔐 Security

Sensitive configuration is intentionally excluded from the repository.

The following should not be committed:

```text
.env
credentials/
service-account JSON files
node_modules/
uploads/
```

Use `.env.example` to document required environment variables without exposing passwords or credentials.

---

## 📊 Example Invoice Processing

### Valid Invoice

```text
Quantity:       10
Unit Price:     ₹100
Subtotal:       ₹1000
GST:            ₹180
Grand Total:    ₹1180
```

The calculation is consistent, so the invoice can proceed to the next stage.

### Invalid Invoice

```text
Quantity:       10
Unit Price:     ₹100
Expected:       ₹1000
Invoice Amount: ₹1100
```

The system detects the discrepancy and marks the invoice for validation/review.

---

## 🔍 API Endpoints

| Method | Endpoint                 | Description                |
| ------ | ------------------------ | -------------------------- |
| GET    | `/api/health`            | Check backend status       |
| POST   | `/api/invoices/upload`   | Upload and process invoice |
| GET    | `/api/invoices`          | Get invoices               |
| GET    | `/api/invoices/:id`      | Get invoice details        |
| PUT    | `/api/invoices/:id`      | Update invoice             |
| DELETE | `/api/invoices/:id`      | Delete invoice             |
| GET    | `/api/invoices/:id/file` | Access invoice file        |

---

## 🎯 Objectives

1. Automate invoice data extraction.
2. Reduce manual data entry.
3. Validate invoice calculations automatically.
4. Detect duplicate invoices.
5. Identify missing or invalid invoice information.
6. Store structured invoice data in a database.
7. Provide a dashboard for invoice monitoring.
8. Reduce the need for manual invoice verification.
9. Route exceptions to human review.

---

## 🌍 Scope

The system can be used for:

* Accounts Payable departments
* Small and medium businesses
* Enterprise invoice processing
* Vendor invoice management
* Financial document processing
* Automated accounting workflows

Future versions can be extended with:

* Advanced fraud detection
* Vendor-specific validation rules
* Email invoice ingestion
* Cloud deployment
* ERP integration
* Multi-language invoice processing
* Machine-learning based anomaly detection
* Automated approval workflows

---

## 📈 Benefits

* Faster invoice processing
* Reduced manual effort
* Improved data accuracy
* Automatic calculation verification
* Duplicate invoice detection
* Centralized invoice records
* Better visibility through dashboard
* Human review only for exceptions

---

## 👨‍💻 Project

**Project Title:**
Invoice Data Extraction and Validation Pipeline

**Domain:**
Artificial Intelligence | Data Extraction | Document Processing | Full Stack Development

**Technologies:**
React.js | Node.js | Express.js | Google Cloud Document AI | MySQL

**Repository:**
https://github.com/Aditya1710S/invoice-data-extraction-validation

