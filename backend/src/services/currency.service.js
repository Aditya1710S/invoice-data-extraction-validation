/**
 * Currency Detection & Exchange Rate Service
 * 
 * Detects invoice currency from multiple signals without assumptions,
 * fetches live/historical exchange rates, and provides USD normalization.
 * Never invents exchange rates. Never overwrites original invoice amounts.
 */

import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// ─── ISO 4217 Currency Lookup Table ───────────────────────────────────────────
export const CURRENCY_REGISTRY = {
  INR: { code: "INR", symbol: "₹", name: "Indian Rupee" },
  USD: { code: "USD", symbol: "$", name: "US Dollar" },
  EUR: { code: "EUR", symbol: "€", name: "Euro" },
  GBP: { code: "GBP", symbol: "£", name: "British Pound Sterling" },
  AED: { code: "AED", symbol: "AED", name: "UAE Dirham" },
  CAD: { code: "CAD", symbol: "CA$", name: "Canadian Dollar" },
  AUD: { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  CNY: { code: "CNY", symbol: "¥", name: "Chinese Yuan Renminbi" },
  CHF: { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  SGD: { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  HKD: { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  NZD: { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  SEK: { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  NOK: { code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  DKK: { code: "DKK", symbol: "kr", name: "Danish Krone" },
  PLN: { code: "PLN", symbol: "zł", name: "Polish Zloty" },
  SAR: { code: "SAR", symbol: "﷼", name: "Saudi Riyal" },
  QAR: { code: "QAR", symbol: "﷼", name: "Qatari Riyal" },
  KRW: { code: "KRW", symbol: "₩", name: "South Korean Won" },
  MYR: { code: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
  THB: { code: "THB", symbol: "฿", name: "Thai Baht" },
  IDR: { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
  ZAR: { code: "ZAR", symbol: "R", name: "South African Rand" },
  MXN: { code: "MXN", symbol: "MX$", name: "Mexican Peso" },
  BRL: { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  PKR: { code: "PKR", symbol: "₨", name: "Pakistani Rupee" },
  BDT: { code: "BDT", symbol: "৳", name: "Bangladeshi Taka" },
  LKR: { code: "LKR", symbol: "Rs", name: "Sri Lankan Rupee" },
  NPR: { code: "NPR", symbol: "Rs", name: "Nepalese Rupee" },
  BHD: { code: "BHD", symbol: "BD", name: "Bahraini Dinar" },
  KWD: { code: "KWD", symbol: "KD", name: "Kuwaiti Dinar" },
  OMR: { code: "OMR", symbol: "﷼", name: "Omani Rial" },
};

// ─── Unambiguous Symbol → Code Mapping ───────────────────────────────────────
// NOTE: "¥" and "$" are AMBIGUOUS – excluded intentionally to force text signals.
const UNAMBIGUOUS_SYMBOL_MAP = {
  "₹": "INR",
  "€": "EUR",
  "£": "GBP",
  "₩": "KRW",
  "฿": "THB",
  "৳": "BDT",
};

// Ambiguous symbols that require additional context
const AMBIGUOUS_SYMBOLS = new Set(["$", "¥"]);

// ─── Contextual Symbol Disambiguation ─────────────────────────────────────────
const DOLLAR_CONTEXT_MAP = [
  { pattern: /CA\$/i, code: "CAD" },
  { pattern: /A\$/i, code: "AUD" },
  { pattern: /NZ\$/i, code: "NZD" },
  { pattern: /S\$/i, code: "SGD" },
  { pattern: /HK\$/i, code: "HKD" },
  { pattern: /MX\$/i, code: "MXN" },
];

const YEN_CONTEXT_MAP = [
  { pattern: /\b(?:jpy|japanese\s+yen|japan)\b/i, code: "JPY" },
  { pattern: /\b(?:cny|rmb|renminbi|yuan|china|chinese)\b/i, code: "CNY" },
];

// ─── Text Name to Code Map ─────────────────────────────────────────────────────
const NAME_TO_CODE = {
  "indian rupee": "INR", "rupee": "INR", "inr": "INR",
  "us dollar": "USD", "u.s. dollar": "USD", "usd": "USD", "dollar": "USD",
  "euro": "EUR", "eur": "EUR", "euros": "EUR",
  "pound sterling": "GBP", "british pound": "GBP", "gbp": "GBP", "pound": "GBP",
  "uae dirham": "AED", "dirham": "AED", "aed": "AED",
  "canadian dollar": "CAD", "cad": "CAD",
  "australian dollar": "AUD", "aud": "AUD",
  "japanese yen": "JPY", "yen": "JPY", "jpy": "JPY",
  "chinese yuan": "CNY", "yuan": "CNY", "renminbi": "CNY", "rmb": "CNY", "cny": "CNY",
  "swiss franc": "CHF", "franc": "CHF", "chf": "CHF",
  "singapore dollar": "SGD", "sgd": "SGD",
  "hong kong dollar": "HKD", "hkd": "HKD",
  "new zealand dollar": "NZD", "nzd": "NZD",
  "swedish krona": "SEK", "sek": "SEK",
  "norwegian krone": "NOK", "nok": "NOK",
  "danish krone": "DKK", "dkk": "DKK",
  "polish zloty": "PLN", "pln": "PLN", "zloty": "PLN",
  "saudi riyal": "SAR", "riyal": "SAR", "sar": "SAR",
  "qatari riyal": "QAR", "qar": "QAR",
  "south korean won": "KRW", "won": "KRW", "krw": "KRW",
  "malaysian ringgit": "MYR", "ringgit": "MYR", "myr": "MYR",
  "thai baht": "THB", "baht": "THB", "thb": "THB",
  "indonesian rupiah": "IDR", "rupiah": "IDR", "idr": "IDR",
  "south african rand": "ZAR", "rand": "ZAR", "zar": "ZAR",
};

/**
 * Detects the invoice currency from multiple signals.
 * Returns { code, symbol, name, status, confidence, reason }
 * status: CONFIDENT | DETECTED | NEEDS_REVIEW | UNKNOWN
 */
export function detectCurrency(extractedData = {}, rawText = "") {
  const text = String(rawText || "").toLowerCase();

  // Signal 1: Explicit ISO code from Document AI entity
  const docAiCurrency = extractedData.currency;
  if (docAiCurrency && CURRENCY_REGISTRY[docAiCurrency.toUpperCase()]) {
    const code = docAiCurrency.toUpperCase();
    logger.info(`[CURRENCY] Detected currency from Document AI entity: ${code}`);
    return {
      ...CURRENCY_REGISTRY[code],
      status: "CONFIDENT",
      confidence: 0.99,
      reason: `Explicit currency code '${code}' detected by Document AI.`,
    };
  }

  // Signal 2: Explicit ISO code in raw text (e.g. "USD", "EUR", "INR")
  for (const code of Object.keys(CURRENCY_REGISTRY)) {
    const isoPattern = new RegExp(`\\b${code}\\b`, "i");
    if (isoPattern.test(rawText)) {
      logger.info(`[CURRENCY] Detected ISO code in text: ${code}`);
      return {
        ...CURRENCY_REGISTRY[code],
        status: "CONFIDENT",
        confidence: 0.95,
        reason: `ISO 4217 currency code '${code}' found in invoice text.`,
      };
    }
  }

  // Signal 3: Currency name in text
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (text.includes(name) && CURRENCY_REGISTRY[code]) {
      logger.info(`[CURRENCY] Detected currency by name: '${name}' -> ${code}`);
      return {
        ...CURRENCY_REGISTRY[code],
        status: "DETECTED",
        confidence: 0.88,
        reason: `Currency name '${name}' detected in invoice text.`,
      };
    }
  }

  // Signal 4: Contextual qualified dollar signs (CA$, A$, NZ$, etc.)
  for (const { pattern, code } of DOLLAR_CONTEXT_MAP) {
    if (pattern.test(rawText) && CURRENCY_REGISTRY[code]) {
      logger.info(`[CURRENCY] Detected qualified dollar symbol -> ${code}`);
      return {
        ...CURRENCY_REGISTRY[code],
        status: "DETECTED",
        confidence: 0.90,
        reason: `Qualified currency symbol detected for ${code}.`,
      };
    }
  }

  // Signal 5: Contextual ¥ disambiguation
  for (const { pattern, code } of YEN_CONTEXT_MAP) {
    if (pattern.test(rawText) && /¥/.test(rawText) && CURRENCY_REGISTRY[code]) {
      logger.info(`[CURRENCY] Disambiguated ¥ -> ${code}`);
      return {
        ...CURRENCY_REGISTRY[code],
        status: "DETECTED",
        confidence: 0.85,
        reason: `Yen symbol with context clue disambiguated to ${code}.`,
      };
    }
  }

  // Signal 6: Unambiguous symbols
  for (const [symbol, code] of Object.entries(UNAMBIGUOUS_SYMBOL_MAP)) {
    if (rawText.includes(symbol) && CURRENCY_REGISTRY[code]) {
      logger.info(`[CURRENCY] Detected unambiguous symbol '${symbol}' -> ${code}`);
      return {
        ...CURRENCY_REGISTRY[code],
        status: "DETECTED",
        confidence: 0.90,
        reason: `Unambiguous currency symbol '${symbol}' detected.`,
      };
    }
  }

  // Signal 7: GSTIN pattern → highly likely INR
  const gstinPattern = /\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/i;
  if (gstinPattern.test(rawText) || extractedData.vendorGst) {
    logger.info(`[CURRENCY] Inferred INR from GSTIN presence`);
    return {
      ...CURRENCY_REGISTRY["INR"],
      status: "DETECTED",
      confidence: 0.80,
      reason: "GSTIN (Indian tax ID) detected — inferred INR currency.",
    };
  }

  // Signal 8: Ambiguous $ sign alone (needs review)
  if (/\$/.test(rawText)) {
    logger.info(`[CURRENCY] Ambiguous $ symbol detected - NEEDS_REVIEW`);
    return {
      code: null,
      symbol: "$",
      name: "Unknown (ambiguous dollar symbol)",
      status: "NEEDS_REVIEW",
      confidence: 0.30,
      reason:
        "A '$' symbol was detected but the specific currency (USD, CAD, AUD, SGD, HKD, NZD, MXN) could not be determined. Manual review required.",
    };
  }

  // Signal 9: Ambiguous ¥ sign alone (needs review)
  if (/¥/.test(rawText)) {
    logger.info(`[CURRENCY] Ambiguous ¥ symbol detected - NEEDS_REVIEW`);
    return {
      code: null,
      symbol: "¥",
      name: "Unknown (ambiguous yen/yuan symbol)",
      status: "NEEDS_REVIEW",
      confidence: 0.30,
      reason:
        "A '¥' symbol was detected but the specific currency (JPY or CNY) could not be determined. Manual review required.",
    };
  }

  // No signals detected
  logger.info(`[CURRENCY] Currency could not be determined - UNKNOWN`);
  return {
    code: null,
    symbol: null,
    name: "Unknown",
    status: "UNKNOWN",
    confidence: 0,
    reason: "No currency signals (ISO code, symbol, or name) detected in the invoice.",
  };
}

// ─── Exchange Rate Service ─────────────────────────────────────────────────────

const BASE_CURRENCY = (process.env.BASE_CURRENCY || "USD").toUpperCase();

// In-memory rate cache (clears on server restart — suitable for dev/production light use)
const rateCache = new Map(); // key: `${from}_${date}` → { rate, fetchedAt }
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Fetches exchange rate from → BASE_CURRENCY (USD).
 * Uses exchangerate.host (free, no API key required for basic usage).
 * Falls back gracefully if unavailable.
 *
 * @param {string} fromCode - ISO 4217 source currency
 * @param {string|null} dateStr - YYYY-MM-DD for historical rate, null for latest
 * @returns {{ rate: number, date: string, source: string } | null}
 */
export async function fetchExchangeRate(fromCode, dateStr = null) {
  if (!fromCode || fromCode.toUpperCase() === BASE_CURRENCY) {
    return { rate: 1.0, date: dateStr || new Date().toISOString().slice(0, 10), source: "identity" };
  }

  const code = fromCode.toUpperCase();
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  const cacheKey = `${code}_${BASE_CURRENCY}_${targetDate}`;

  // Check cache
  const cached = rateCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    logger.info(`[CURRENCY] Exchange rate (cached): 1 ${code} = ${cached.rate} ${BASE_CURRENCY}`);
    return { rate: cached.rate, date: targetDate, source: "cache" };
  }

  // Try exchangerate.host (free, no key required)
  const apiKey = process.env.EXCHANGE_RATE_API_KEY || "";

  // Strategy 1: exchangerate.host (historical or latest)
  try {
    let url;
    if (dateStr) {
      // Historical rate
      url = `https://api.exchangerate.host/${targetDate}?base=${code}&symbols=${BASE_CURRENCY}`;
    } else {
      // Latest rate
      url = `https://api.exchangerate.host/latest?base=${code}&symbols=${BASE_CURRENCY}`;
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json();
      const rate = data?.rates?.[BASE_CURRENCY];
      if (rate && typeof rate === "number" && rate > 0) {
        rateCache.set(cacheKey, { rate, fetchedAt: Date.now() });
        logger.info(`[CURRENCY] Exchange rate fetched from exchangerate.host: 1 ${code} = ${rate} ${BASE_CURRENCY}`);
        return { rate, date: data.date || targetDate, source: "exchangerate.host" };
      }
    }
  } catch (err) {
    logger.info(`[CURRENCY] exchangerate.host unavailable: ${err.message}`);
  }

  // Strategy 2: Frankfurter API (ECB rates, free, no key required)
  try {
    let url;
    if (dateStr) {
      url = `https://api.frankfurter.app/${targetDate}?from=${code}&to=${BASE_CURRENCY}`;
    } else {
      url = `https://api.frankfurter.app/latest?from=${code}&to=${BASE_CURRENCY}`;
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json();
      const rate = data?.rates?.[BASE_CURRENCY];
      if (rate && typeof rate === "number" && rate > 0) {
        rateCache.set(cacheKey, { rate, fetchedAt: Date.now() });
        logger.info(`[CURRENCY] Exchange rate fetched from Frankfurter API: 1 ${code} = ${rate} ${BASE_CURRENCY}`);
        return { rate, date: data.date || targetDate, source: "frankfurter.app" };
      }
    }
  } catch (err) {
    logger.info(`[CURRENCY] Frankfurter API unavailable: ${err.message}`);
  }

  // All sources failed
  logger.info(`[CURRENCY] Exchange rate unavailable for ${code} on ${targetDate}`);
  return null;
}

/**
 * Performs USD normalization for a given invoice amount.
 * Never invents a rate. Returns null if rate is unavailable.
 *
 * @param {number} originalAmount - Amount in original currency
 * @param {string} currencyCode - ISO 4217 code of original currency
 * @param {string|null} invoiceDateStr - YYYY-MM-DD invoice date for historical rate
 * @returns {{ convertedAmount: number, rate: number, rateDate: string, source: string } | null}
 */
export async function convertToBaseCurrency(originalAmount, currencyCode, invoiceDateStr = null) {
  if (!originalAmount || !currencyCode) return null;

  const rateData = await fetchExchangeRate(currencyCode, invoiceDateStr);
  if (!rateData) {
    logger.info(`[CURRENCY] Conversion unavailable for ${currencyCode} → ${BASE_CURRENCY}`);
    return null;
  }

  const convertedAmount = Math.round(originalAmount * rateData.rate * 100) / 100;
  logger.info(`[CURRENCY] Converted ${originalAmount} ${currencyCode} → ${convertedAmount} ${BASE_CURRENCY} (rate: ${rateData.rate})`);

  return {
    convertedAmount,
    rate: rateData.rate,
    rateDate: rateData.date,
    source: rateData.source,
    baseCurrency: BASE_CURRENCY,
  };
}

/**
 * Full currency resolution pipeline for an extracted invoice.
 * 
 * @param {object} extractedData - Extracted invoice data
 * @param {string} rawText - Raw OCR text from invoice
 * @param {number|null} grandTotal - The original grand total amount
 * @param {string|null} invoiceDateStr - Invoice date for historical rates
 * @returns {object} Currency metadata for storage
 */
export async function resolveCurrencyForInvoice(extractedData, rawText, grandTotal, invoiceDateStr) {
  const detection = detectCurrency(extractedData, rawText);

  const result = {
    currency_code: detection.code,
    currency_symbol: detection.symbol,
    currency_name: detection.name,
    currency_status: detection.status,
    currency_confidence: detection.confidence,
    currency_reason: detection.reason,
    base_currency: BASE_CURRENCY,
    exchange_rate: null,
    converted_total: null,
    exchange_rate_date: null,
    exchange_rate_source: null,
  };

  // Only convert if currency is confidently or detectably known and we have a total
  if (
    detection.code &&
    (detection.status === "CONFIDENT" || detection.status === "DETECTED") &&
    grandTotal > 0
  ) {
    const conversion = await convertToBaseCurrency(grandTotal, detection.code, invoiceDateStr);

    if (conversion) {
      result.exchange_rate = conversion.rate;
      result.converted_total = conversion.convertedAmount;
      result.exchange_rate_date = conversion.rateDate;
      result.exchange_rate_source = conversion.source;
      logger.info(`[CURRENCY] Conversion completed: ${grandTotal} ${detection.code} = ${conversion.convertedAmount} ${BASE_CURRENCY}`);
    } else {
      // Rate unavailable — preserve original, mark for review
      result.currency_status = "NEEDS_REVIEW";
      result.currency_reason = `${detection.reason} | USD conversion unavailable — exchange rate service unreachable.`;
      logger.info(`[CURRENCY] Currency requires review due to unavailable exchange rate`);
    }
  } else if (detection.status === "NEEDS_REVIEW" || detection.status === "UNKNOWN") {
    logger.info(`[CURRENCY] Currency requires review: ${detection.reason}`);
  }

  return result;
}

export { BASE_CURRENCY };
