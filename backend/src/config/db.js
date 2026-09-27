import mysql from "mysql2/promise";
import { env } from "./env.js";

const dbConfig = {
  host: env.db.host || "localhost",
  port: env.db.port || 3306,
  user: env.db.user || "root",
  password: env.db.password || "1234",
  database: env.db.name || "invoiceflow",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

export const pool = mysql.createPool(dbConfig);

export async function ensureInvoiceColumns(conn = pool) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices'",
    [dbConfig.database]
  );

  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  const requiredColumns = [
    ["currency_code", "VARCHAR(10) NULL"],
    ["currency_symbol", "VARCHAR(20) NULL"],
    ["currency_name", "VARCHAR(100) NULL"],
    ["currency_status", "VARCHAR(30) DEFAULT 'UNKNOWN'"],
    ["base_currency", "VARCHAR(10) DEFAULT 'USD'"],
    ["exchange_rate", "DECIMAL(20,8) NULL"],
    ["converted_total", "DECIMAL(20,2) NULL"],
    ["exchange_rate_date", "DATE NULL"],
    ["exchange_rate_source", "VARCHAR(100) NULL"],
    ["batch_id", "VARCHAR(100) NULL"],
    ["processing_status", "VARCHAR(30) DEFAULT 'COMPLETED'"],
  ];

  for (const [columnName, definition] of requiredColumns) {
    if (!existing.has(columnName)) {
      await conn.query(`ALTER TABLE \`invoices\` ADD COLUMN \`${columnName}\` ${definition}`);
      existing.add(columnName);
    }
  }
}

export async function initDatabase() {
  try {
    // 1. Connect without DB selected to ensure Database exists
    const rootConn = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
    await rootConn.end();

    // 2. Initialize tables in DB
    const conn = await pool.getConnection();

    // Main invoices table with full multi-currency schema
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`invoices\` (
        \`invoice_id\` VARCHAR(255) NOT NULL PRIMARY KEY,
        \`vendor_name\` VARCHAR(255) NULL,
        \`vendor_gstin\` VARCHAR(50) NULL,
        \`invoice_number\` VARCHAR(100) NULL,
        \`invoice_date\` DATE NULL,
        \`po_number\` VARCHAR(100) NULL,
        \`subtotal\` DECIMAL(20,2) DEFAULT 0.00,
        \`tax_amount\` DECIMAL(20,2) DEFAULT 0.00,
        \`grand_total\` DECIMAL(20,2) DEFAULT 0.00,
        \`validation_status\` VARCHAR(50) DEFAULT 'PENDING',
        \`duplicate_status\` VARCHAR(50) DEFAULT 'NOT_DUPLICATE',
        \`file_path\` VARCHAR(550) NULL,
        \`original_filename\` VARCHAR(255) NULL,
        \`mime_type\` VARCHAR(100) NULL,
        \`size_bytes\` BIGINT DEFAULT 0,
        \`file_hash\` VARCHAR(64) NULL,
        \`confidence\` DECIMAL(5,2) DEFAULT 0.95,
        \`due_date\` DATE NULL,
        \`currency\` VARCHAR(10) DEFAULT 'INR',
        \`discount\` DECIMAL(20,2) DEFAULT 0.00,
        \`extracted_data_json\` LONGTEXT NULL,
        \`validation_errors_json\` LONGTEXT NULL,
        \`processing_logs_json\` LONGTEXT NULL,
        \`currency_code\` VARCHAR(10) NULL,
        \`currency_symbol\` VARCHAR(20) NULL,
        \`currency_name\` VARCHAR(100) NULL,
        \`currency_status\` VARCHAR(30) DEFAULT 'UNKNOWN',
        \`base_currency\` VARCHAR(10) DEFAULT 'USD',
        \`exchange_rate\` DECIMAL(20,8) NULL,
        \`converted_total\` DECIMAL(20,2) NULL,
        \`exchange_rate_date\` DATE NULL,
        \`exchange_rate_source\` VARCHAR(100) NULL,
        \`batch_id\` VARCHAR(100) NULL,
        \`processing_status\` VARCHAR(30) DEFAULT 'COMPLETED',
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_vendor (\`vendor_name\`),
        INDEX idx_invoice_num (\`invoice_number\`),
        INDEX idx_status (\`validation_status\`),
        INDEX idx_currency (\`currency_code\`),
        INDEX idx_batch (\`batch_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Safe idempotent column additions for existing databases
    await ensureInvoiceColumns(conn);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`invoice_items\` (
        \`item_id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`invoice_id\` VARCHAR(255) NOT NULL,
        \`description\` TEXT NULL,
        \`quantity\` DECIMAL(10,2) DEFAULT 1.00,
        \`unit_price\` DECIMAL(20,2) DEFAULT 0.00,
        \`tax_amount\` DECIMAL(20,2) DEFAULT 0.00,
        \`line_total\` DECIMAL(20,2) DEFAULT 0.00,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (\`invoice_id\`) REFERENCES \`invoices\`(\`invoice_id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`invoice_batches\` (
        \`batch_id\` VARCHAR(100) NOT NULL PRIMARY KEY,
        \`total_invoices\` INT DEFAULT 0,
        \`processed_invoices\` INT DEFAULT 0,
        \`valid_count\` INT DEFAULT 0,
        \`invalid_count\` INT DEFAULT 0,
        \`review_count\` INT DEFAULT 0,
        \`failed_count\` INT DEFAULT 0,
        \`duplicate_count\` INT DEFAULT 0,
        \`status\` VARCHAR(30) DEFAULT 'PROCESSING',
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`completed_at\` DATETIME NULL,
        INDEX idx_batch_status (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`notifications\` (
        \`notification_id\` VARCHAR(255) NOT NULL PRIMARY KEY,
        \`title\` VARCHAR(255) NOT NULL,
        \`message\` TEXT NOT NULL,
        \`type\` VARCHAR(50) DEFAULT 'info',
        \`invoice_id\` VARCHAR(255) NULL,
        \`is_read\` TINYINT(1) DEFAULT 0,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created (\`created_at\`),
        INDEX idx_read (\`is_read\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    conn.release();
    console.log("✅ MySQL Database & Tables initialized successfully (multi-currency schema).");
    return true;
  } catch (error) {
    console.error("❌ MySQL initialization failed:", error.message);
    throw error;
  }
}
