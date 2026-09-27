/**
 * Validation Engine for Invoice Data Processing
 * Independently verifies line items, subtotals, tax/GST, and grand totals.
 * All validation is performed in the invoice's ORIGINAL currency.
 * Never converts to USD before validating arithmetic.
 */

const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Robustly parses financial numeric values from strings containing currency symbols,
 * commas, spaces, or formatting (e.g., "$8,500.00", "₹8,500.00", "€1,224", "£500", "AED 1,000").
 * Handles all ISO 4217 currency symbols by stripping non-numeric characters safely.
 */
export function parseAmount(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const cleaned = String(val)
    // Remove common currency symbols and codes (multi-currency support)
    .replace(/[₹$€£¥₩฿৳₨﷼]/g, "")
    .replace(/\b(?:INR|USD|EUR|GBP|AED|CAD|AUD|JPY|CNY|CHF|SGD|HKD|NZD|SEK|NOK|DKK|PLN|SAR|QAR|KRW|MYR|THB|IDR|ZAR|MXN|BRL|PKR|BDT|LKR|NPR|BHD|KWD|OMR)\b/gi, "")
    .replace(/\bRs\.?\b/gi, "")
    .replace(/[,]/g, "")
    .trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Returns a display string for amounts using the detected currency symbol.
 * Falls back to the amount as a number string if no symbol provided.
 */
function fmtAmount(amount, currencySymbol) {
  const sym = currencySymbol || "";
  return `${sym}${Number(amount).toLocaleString("en-US")}`;
}

export function validateExtractedInvoice(extractedData, existingInvoices = [], currentId = null, currencyMeta = {}) {
  const errors = [];
  const currencySymbol = currencyMeta?.currency_symbol || "";
  const currencyCode = currencyMeta?.currency_code || "";

  if (!extractedData) {
    return {
      status: "INVALID",
      isValid: false,
      calculatedSubtotal: 0,
      extractedSubtotal: 0,
      calculatedTax: 0,
      extractedTax: 0,
      calculatedGrandTotal: 0,
      extractedGrandTotal: 0,
      difference: 0,
      errors: [
        {
          type: "MISSING_INFO",
          message: "No data could be extracted from the invoice file.",
          severity: "error",
        },
      ],
      duplicateOfId: null,
    };
  }

  const {
    vendorName,
    vendorGst,
    invoiceNumber,
    invoiceDate,
    subtotal,
    totalTax,
    taxRate,
    discount = 0,
    shipping = 0,
    additionalCharges = 0,
    totalAmount,
    grandTotal,
    lineItems = [],
  } = extractedData;

  // Parse extracted financial numbers safely (strips any currency symbol)
  const extractedSubtotal = parseAmount(subtotal || extractedData.netAmount);
  const extractedTax = parseAmount(totalTax || extractedData.taxAmount);
  const extractedDiscount = parseAmount(discount);
  const extractedShipping = parseAmount(shipping || additionalCharges);
  const extractedGrandTotal = parseAmount(totalAmount || grandTotal || extractedData.total);

  // 1. Missing Required Information Checks
  if (!invoiceNumber) {
    errors.push({
      type: "MISSING_INFO",
      message: "Invoice number is missing from extracted data.",
      severity: "error",
    });
  }

  if (!vendorName) {
    errors.push({
      type: "MISSING_INFO",
      message: "Vendor name is missing.",
      severity: "error",
    });
  }

  if (!invoiceDate) {
    errors.push({
      type: "MISSING_INFO",
      message: "Invoice date is missing.",
      severity: "error",
    });
  }

  // 2. Tax ID Format Check — GST/VAT/Tax ID validation
  const gstToVerify = vendorGst || extractedData.gstNumber;
  if (!gstToVerify) {
    errors.push({
      type: "FORMAT_ERROR",
      message: "Missing or invalid GST/VAT/Tax ID number for vendor.",
      severity: "error",
    });
  } else if (
    typeof gstToVerify === "string" &&
    gstToVerify.length === 15 &&
    !GST_REGEX.test(gstToVerify.trim().toUpperCase())
  ) {
    errors.push({
      type: "FORMAT_ERROR",
      message: `Tax ID format warning: '${gstToVerify}' may not follow standard structure.`,
      severity: "warning",
    });
  }

  // 3. Line Item Independent Validation & Subtotal Calculation
  // ALL calculations stay in original invoice currency
  let calculatedSubtotal = 0;

  if (lineItems.length > 0) {
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      const desc = item.description || item.name || `Item ${i + 1}`;
      const qty = parseAmount(item.quantity ?? item.qty ?? 1);
      const unitPrice = parseAmount(item.unitPrice ?? item.price);
      const extractedLineTotal = parseAmount(item.amount ?? item.total ?? item.line_total);

      const calculatedLineTotal = Math.round(qty * unitPrice * 100) / 100;
      calculatedSubtotal += calculatedLineTotal;

      if (qty > 0 && unitPrice > 0 && extractedLineTotal > 0) {
        if (Math.abs(calculatedLineTotal - extractedLineTotal) > 0.02) {
          errors.push({
            type: "LINE_ITEM_MISMATCH",
            message: `Line item calculation mismatch for '${desc}' — calculated ${fmtAmount(calculatedLineTotal, currencySymbol)}${currencyCode ? ` ${currencyCode}` : ""}, invoice states ${fmtAmount(extractedLineTotal, currencySymbol)}${currencyCode ? ` ${currencyCode}` : ""}`,
            severity: "error",
            expected: calculatedLineTotal,
            actual: extractedLineTotal,
            difference: Math.round(Math.abs(calculatedLineTotal - extractedLineTotal) * 100) / 100,
          });
        }
      }
    }
  } else {
    calculatedSubtotal = extractedSubtotal;
  }

  calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;

  // 4. Subtotal Validation (in original currency)
  if (lineItems.length > 0 && extractedSubtotal > 0) {
    if (Math.abs(calculatedSubtotal - extractedSubtotal) > 0.02) {
      errors.push({
        type: "SUBTOTAL_MISMATCH",
        message: `Subtotal mismatch — calculated sum of line items is ${fmtAmount(calculatedSubtotal, currencySymbol)}${currencyCode ? ` ${currencyCode}` : ""}, invoice states ${fmtAmount(extractedSubtotal, currencySymbol)}${currencyCode ? ` ${currencyCode}` : ""}`,
        severity: "error",
        expected: calculatedSubtotal,
        actual: extractedSubtotal,
        difference: Math.round(Math.abs(calculatedSubtotal - extractedSubtotal) * 100) / 100,
      });
    }
  }

  const effectiveSubtotal = calculatedSubtotal > 0 ? calculatedSubtotal : extractedSubtotal;

  // 5. Tax / GST / VAT Validation (in original currency, supports multiple tax systems)
  let calculatedTax = 0;
  const numTaxRate = parseAmount(taxRate);

  if (numTaxRate > 0) {
    calculatedTax = Math.round((effectiveSubtotal * (numTaxRate / 100)) * 100) / 100;
  } else if (extractedTax > 0) {
    calculatedTax = extractedTax;
  }

  if (numTaxRate > 0 && extractedTax > 0) {
    const expectedTaxByRate = Math.round((effectiveSubtotal * (numTaxRate / 100)) * 100) / 100;
    if (Math.abs(expectedTaxByRate - extractedTax) > 0.05) {
      errors.push({
        type: "TAX_MISMATCH",
        message: `Tax mismatch — calculated ${numTaxRate}% is ${fmtAmount(expectedTaxByRate, currencySymbol)}${currencyCode ? ` ${currencyCode}` : ""}, invoice states ${fmtAmount(extractedTax, currencySymbol)}${currencyCode ? ` ${currencyCode}` : ""}`,
        severity: "error",
        expected: expectedTaxByRate,
        actual: extractedTax,
        difference: Math.round(Math.abs(expectedTaxByRate - extractedTax) * 100) / 100,
      });
    }
  }

  const effectiveTax = calculatedTax > 0 ? calculatedTax : extractedTax;

  // 6. Grand Total Validation — INDEPENDENT MATHEMATICAL VERIFICATION in original currency
  const calculatedGrandTotal = Math.round(
    Math.max(0, effectiveSubtotal - extractedDiscount + effectiveTax + extractedShipping) * 100
  ) / 100;

  const difference = Math.round(Math.abs(calculatedGrandTotal - extractedGrandTotal) * 100) / 100;

  if (extractedGrandTotal > 0 && difference > 0.02) {
    errors.push({
      type: "TOTAL_MISMATCH",
      message: `Grand Total does not match subtotal + tax${currencyCode ? ` (${currencyCode})` : ""}`,
      severity: "error",
      expected: calculatedGrandTotal,
      actual: extractedGrandTotal,
      difference: difference,
    });
  }

  // 7. Business Duplicate Check
  let isBusinessDuplicate = false;
  let duplicateOfId = null;

  if (invoiceNumber && vendorName) {
    const normNum = String(invoiceNumber).trim().toLowerCase();
    const normVendor = String(vendorName).trim().toLowerCase();

    const match = existingInvoices.find((inv) => {
      if (currentId && (inv.id === currentId || inv.invoice_id === currentId)) return false;
      const invNum = String(inv.extractedData?.invoiceNumber || inv.invoiceNumber || inv.invoice_number || "").trim().toLowerCase();
      const invVendor = String(inv.extractedData?.vendorName || inv.vendor?.name || inv.vendor_name || "").trim().toLowerCase();
      return invNum === normNum && invVendor === normVendor;
    });

    if (match) {
      isBusinessDuplicate = true;
      duplicateOfId = match.id || match.invoice_id;
      errors.push({
        type: "DUPLICATE_CHECK",
        message: `Business duplicate detected: matching invoice #${invoiceNumber} for vendor '${vendorName}' (Invoice ID: ${duplicateOfId}).`,
        severity: "warning",
      });
    }
  }

  // Determine Final Status
  const hasErrors = errors.some((e) => e.severity === "error");
  const hasWarnings = errors.some((e) => e.severity === "warning");

  let status = "VALID";
  if (isBusinessDuplicate) {
    status = "DUPLICATE";
  } else if (hasErrors) {
    status = "INVALID";
  } else if (hasWarnings) {
    status = "NEEDS_REVIEW";
  }

  return {
    status,
    isValid: !hasErrors && !isBusinessDuplicate,
    calculatedSubtotal: effectiveSubtotal,
    extractedSubtotal,
    calculatedTax: effectiveTax,
    extractedTax,
    calculatedGrandTotal,
    extractedGrandTotal,
    difference,
    errors,
    duplicateOfId: duplicateOfId || null,
  };
}
