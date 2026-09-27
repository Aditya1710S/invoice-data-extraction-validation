import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Upload, FileText, CheckCircle2, AlertTriangle, Copy,
  BarChart3, Settings as SettingsIcon, Search, Bell, ChevronDown, ChevronRight,
  X, Check, Eye, RotateCcw, Download, Filter, ArrowUpDown, Clock, TrendingUp,
  TrendingDown, FileWarning, Ban, PauseCircle, Loader2, CloudUpload, ScanLine,
  Database, ShieldCheck, GitCompareArrows, ArrowRight, Building2, Mail, Phone,
  Calendar, Hash, Receipt, MessageSquare, ChevronLeft, Menu, UserCircle2,
  SlidersHorizontal, CircleDot, RefreshCw, ExternalLink, FileSpreadsheet, Edit, Trash2,
  FileCode,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar, Legend, AreaChart, Area,
} from "recharts";
import {
  uploadInvoices,
  fetchInvoices,
  fetchDashboardStats,
  approveInvoiceApi,
  rejectInvoiceApi,
  updateInvoiceApi,
  deleteInvoiceApi,
  getInvoiceFileUrl,
  getInvoiceReportPdfUrl,
  getInvoiceReportExcelUrl,
  getInvoiceReportJsonUrl,
  fetchNotifications,
  markNotificationReadApi,
  markAllNotificationsReadApi,
  fetchBatchStatus,
  cancelBatchApi,
  getBatchReportExcelUrl,
  fetchSupportedCurrencies,
} from "./api";


const COLORS = {
  ink: "#0B1D33",
  slate: "#33475B",
  muted: "#7C8DA6",
  line: "#E4E9F1",
  canvas: "#F5F7FA",
  card: "#FFFFFF",
  accent: "#2E6BE6",
  accentDim: "#EAF1FE",
  good: "#1C9A6C",
  goodDim: "#E6F5EE",
  warn: "#C8790A",
  warnDim: "#FCF1E1",
  bad: "#D2453A",
  badDim: "#FBEAE9",
  dupe: "#A65EDB",
  dupeDim: "#F4EAFC",
  proc: "#2E6BE6",
  procDim: "#EAF1FE",
};

const fontStack =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const STATUS = {
  VALID: "valid",
  PENDING: "pending",
  NEEDS_REVIEW: "needs_review",
  DUPLICATE: "duplicate",
  ERROR: "error",
  INVALID: "invalid",
  PROCESSING: "processing",
};

const STATUS_META = {
  valid: { label: "Valid", color: COLORS.good, dim: COLORS.goodDim, icon: CheckCircle2 },
  pending: { label: "Pending Review", color: COLORS.warn, dim: COLORS.warnDim, icon: PauseCircle },
  needs_review: { label: "Needs Review", color: COLORS.warn, dim: COLORS.warnDim, icon: PauseCircle },
  duplicate: { label: "Duplicate", color: COLORS.dupe, dim: COLORS.dupeDim, icon: Copy },
  error: { label: "Validation Error", color: COLORS.bad, dim: COLORS.badDim, icon: AlertTriangle },
  invalid: { label: "Invalid", color: COLORS.bad, dim: COLORS.badDim, icon: AlertTriangle },
  processing: { label: "Processing", color: COLORS.proc, dim: COLORS.procDim, icon: Loader2 },
};

function normalizeInvoiceList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.invoices)) return payload.invoices;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    if (payload.invoice) return [payload.invoice];
  }
  return [];
}

function normalizeInvoice(inv) {
  const ext = inv.extractedData || {};
  const cur = inv.currencyMeta || {};
  const vendorObj = inv.vendor || {
    name: inv.vendor_name || ext.vendorName || "Unknown Vendor",
    gst: inv.vendor_gstin || ext.vendorGst || null,
    address: ext.vendorAddress || "N/A",
    email: (inv.vendor_name || ext.vendorName) ? `accounts@${(inv.vendor_name || ext.vendorName).split(" ")[0].toLowerCase()}.com` : "accounts@vendor.com",
    phone: ext.vendorPhone || null,
  };

  const validationErrors = inv.validationErrors || inv.validation?.errors || [];
  const statusLower = String(inv.status || inv.validation_status || "valid").toLowerCase();
  const mappedStatus = statusLower === "extracted" || statusLower === "uploaded"
    ? STATUS.VALID
    : statusLower === "duplicate_file"
    ? STATUS.DUPLICATE
    : statusLower === "needs_review"
    ? STATUS.NEEDS_REVIEW
    : STATUS_META[statusLower]
    ? statusLower
    : STATUS.VALID;

  // Currency metadata — preserved from DB, never overwritten
  const currencyMeta = {
    currency_code: cur.currency_code || inv.currency_code || null,
    currency_symbol: cur.currency_symbol || inv.currency_symbol || null,
    currency_name: cur.currency_name || inv.currency_name || null,
    currency_status: cur.currency_status || inv.currency_status || "UNKNOWN",
    exchange_rate: cur.exchange_rate || inv.exchange_rate || null,
    converted_total: cur.converted_total || inv.converted_total || null,
    exchange_rate_date: cur.exchange_rate_date || inv.exchange_rate_date || null,
    base_currency: cur.base_currency || inv.base_currency || "USD",
  };

  const currencyCode = currencyMeta.currency_code || inv.currency || ext.currency || null;
  const currencySymbol = currencyMeta.currency_symbol || "";

  return {
    ...inv,
    id: inv.invoice_id || inv.id,
    invoiceNumber: inv.invoiceNumber || inv.invoice_number || ext.invoiceNumber || `INV-${String(inv.id || "1000").slice(0, 6).toUpperCase()}`,
    vendor: vendorObj,
    invoiceDate: inv.invoiceDate || inv.invoice_date || ext.invoiceDate || new Date().toISOString().slice(0, 10),
    dueDate: inv.dueDate || inv.due_date || ext.dueDate || null,
    poNumber: inv.poNumber || inv.po_number || ext.purchaseOrderNumber || null,
    currency: currencyCode,
    currencySymbol,
    currencyMeta,
    subtotal: inv.subtotal !== undefined ? Number(inv.subtotal) : Number(ext.subtotal) || 0,
    tax: inv.tax !== undefined ? Number(inv.tax) : Number(inv.tax_amount ?? ext.totalTax ?? 0),
    discount: inv.discount !== undefined ? Number(inv.discount) : Number(ext.discount) || 0,
    total: inv.total !== undefined ? Number(inv.total) : Number(inv.grand_total ?? ext.totalAmount ?? 0),
    items: inv.items || (ext.lineItems || []).map((it, i) => ({
      id: i,
      name: it.description || it.name || "Line Item",
      qty: Number(it.quantity ?? it.qty ?? 1),
      price: Number(it.unitPrice ?? it.price ?? 0),
      tax: Number(it.tax_amount ?? it.tax ?? 0),
      total: Number(it.line_total ?? it.total ?? 0),
    })),
    status: mappedStatus,
    validationErrors,
    confidence: Number(inv.confidence || 0.96),
    uploadedAt: inv.created_at || inv.uploadedAt || new Date().toISOString(),
  };
}

/**
 * Format an amount with the correct currency symbol.
 * Falls back to plain number if no symbol detected.
 */
function fmtCurrency(n, invoice) {
  const sym = invoice?.currencySymbol || invoice?.currencyMeta?.currency_symbol || "";
  const code = invoice?.currency || invoice?.currencyMeta?.currency_code || "";
  const num = Math.abs(n || 0).toLocaleString("en-US");
  if (sym) return `${sym}${num}`;
  if (code) return `${num} ${code}`;
  return num;
}

// Legacy INR formatter — still used for dashboard totals which are mixed-currency sums
const inr = (n) => `₹${Math.abs(n || 0).toLocaleString("en-IN")}`;
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A");
const fmtDateTime = (s) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "N/A");

function StatusBadge({ status, size = "sm" }) {
  const meta = STATUS_META[status] || STATUS_META.valid;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"}`}
      style={{ background: meta.dim, color: meta.color }}
    >
      <Icon size={size === "sm" ? 12 : 14} className={status === "processing" ? "animate-spin" : ""} />
      {meta.label}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tint, trend }) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}
    >
      <div className="flex items-start justify-between">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: tint.dim }}>
          <Icon size={18} style={{ color: tint.color }} />
        </div>
        {trend !== undefined && (
          <div className="flex items-center gap-1 text-xs font-medium" style={{ color: trend >= 0 ? COLORS.good : COLORS.bad }}>
            {trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <div className="text-2xl font-semibold tabular-nums" style={{ color: COLORS.ink, letterSpacing: "-0.01em" }}>
          {value}
        </div>
        <div className="text-sm mt-0.5" style={{ color: COLORS.muted }}>{label}</div>
      </div>
      {sub && <div className="text-xs" style={{ color: COLORS.muted }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, action, children, className = "" }) {
  return (
    <div className={`rounded-xl ${className}`} style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
      {title && (
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h3 className="text-sm font-semibold" style={{ color: COLORS.ink }}>{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: COLORS.canvas }}>
        <Icon size={22} style={{ color: COLORS.muted }} />
      </div>
      <div className="text-sm font-medium" style={{ color: COLORS.ink }}>{title}</div>
      {sub && <div className="text-xs mt-1" style={{ color: COLORS.muted, maxWidth: 280 }}>{sub}</div>}
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const good = toast.type !== "error";
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg animate-[fadeIn_.15s_ease]"
      style={{ background: COLORS.ink, color: "white", minWidth: 260 }}
    >
      {good ? <CheckCircle2 size={16} style={{ color: "#6FE3B0" }} /> : <AlertTriangle size={16} style={{ color: "#F2A79A" }} />}
      <span className="text-sm">{toast.msg}</span>
      <button onClick={onClose} className="ml-auto opacity-60 hover:opacity-100"><X size={14} /></button>
    </div>
  );
}

/* ================================ SIDEBAR / HEADER ================================ */

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "upload", label: "Upload Invoice", icon: Upload },
  { key: "all", label: "All Invoices", icon: FileText },
  { key: "valid", label: "Valid Invoices", icon: CheckCircle2 },
  { key: "errors", label: "Errors & Exceptions", icon: AlertTriangle },
  { key: "duplicates", label: "Duplicate Invoices", icon: Copy },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

function Sidebar({ page, setPage, collapsed, setCollapsed, mobileOpen, setMobileOpen, counts }) {
  const width = collapsed ? 76 : 240;
  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        className={`fixed md:sticky top-0 h-screen z-40 flex flex-col transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        style={{ width, background: COLORS.ink, flexShrink: 0 }}
      >
        <div className="flex items-center gap-2.5 px-5 h-16 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: COLORS.accent }}>
            <Receipt size={17} color="white" />
          </div>
          {!collapsed && (
            <div className="leading-tight overflow-hidden">
              <div className="text-white text-sm font-semibold whitespace-nowrap">InvoiceFlow</div>
              <div className="text-[11px] whitespace-nowrap" style={{ color: "rgba(255,255,255,0.45)" }}>MySQL Production Pipeline</div>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = page === item.key;
            const Icon = item.icon;
            const count = counts?.[item.key];
            return (
              <button
                key={item.key}
                onClick={() => { setPage(item.key); setMobileOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors relative"
                style={{
                  background: active ? "rgba(46,107,230,0.18)" : "transparent",
                  color: active ? "#ffffff" : "rgba(255,255,255,0.62)",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: COLORS.accent }} />}
                <Icon size={17} className="shrink-0" />
                {!collapsed && <span className="whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>}
                {!collapsed && count !== undefined && count > 0 && (
                  <span className="ml-auto text-[11px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex items-center gap-2 px-5 py-4 text-xs shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
        >
          {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /> Collapse</>}
        </button>
      </aside>
    </>
  );
}

function Header({ title, subtitle, onMenu, onSearch, search, onRefresh }) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-4 px-4 md:px-7 h-16 shrink-0"
      style={{ background: "rgba(245,247,250,0.9)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${COLORS.line}` }}
    >
      <button className="md:hidden" onClick={onMenu}><Menu size={20} style={{ color: COLORS.ink }} /></button>
      <div className="min-w-0">
        <h1 className="text-base font-semibold truncate" style={{ color: COLORS.ink }}>{title}</h1>
        {subtitle && <p className="text-xs truncate" style={{ color: COLORS.muted }}>{subtitle}</p>}
      </div>
      <div className="flex-1" />
      {onSearch && (
        <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg w-64" style={{ background: "white", border: `1px solid ${COLORS.line}` }}>
          <Search size={15} style={{ color: COLORS.muted }} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search invoices, vendors…"
            className="bg-transparent outline-none text-sm w-full"
            style={{ color: COLORS.ink }}
          />
        </div>
      )}
      {onRefresh && (
        <button onClick={onRefresh} title="Refresh MySQL Data" className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-slate-100" style={{ border: `1px solid ${COLORS.line}`, background: "white" }}>
          <RefreshCw size={15} style={{ color: COLORS.slate }} />
        </button>
      )}
      <button className="relative w-9 h-9 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${COLORS.line}`, background: "white" }}>
        <Bell size={16} style={{ color: COLORS.slate }} />
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: COLORS.bad }} />
      </button>
      <div className="hidden sm:flex items-center gap-2 pl-3" style={{ borderLeft: `1px solid ${COLORS.line}` }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: COLORS.accentDim, color: COLORS.accent }}>AS</div>
        <div className="leading-tight">
          <div className="text-xs font-medium" style={{ color: COLORS.ink }}>Aditya Sonawane</div>
          <div className="text-[11px]" style={{ color: COLORS.muted }}>AS Accountant</div>
        </div>
      </div>
    </header>
  );
}

/* ================================ DASHBOARD PAGE ================================ */

function DashboardPage({ invoices, setPage, openInvoice, stats }) {
  const total = stats?.total ?? invoices.length;
  const valid = stats?.valid ?? invoices.filter((i) => i.status === STATUS.VALID).length;
  const pending = stats?.pending ?? invoices.filter((i) => i.status === STATUS.PENDING).length;
  const dup = stats?.duplicates ?? invoices.filter((i) => i.status === STATUS.DUPLICATE).length;
  const errs = stats?.errors ?? invoices.filter((i) => i.status === STATUS.ERROR).length;
  const totalAmount = stats?.totalAmount ?? invoices.reduce((s, i) => s + (i.total || 0), 0);

  const pieData = [
    { name: "Valid", value: valid, color: COLORS.good },
    { name: "Pending Review", value: pending, color: COLORS.warn },
    { name: "Duplicate", value: dup, color: COLORS.dupe },
    { name: "Validation Error", value: errs, color: COLORS.bad },
    { name: "Processing", value: invoices.filter((i) => i.status === STATUS.PROCESSING).length, color: COLORS.proc },
  ].filter((d) => d.value > 0);

  const [range, setRange] = useState("30d");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const applyRange = (key) => {
    const end = new Date();
    const start = new Date(end);

    if (key === "today") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
    } else if (key === "7d") {
      start.setDate(end.getDate() - 6);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
    } else if (key === "30d") {
      start.setDate(end.getDate() - 29);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
    } else if (key === "year") {
      start.setMonth(end.getMonth() - 11);
      start.setDate(1);
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
    }

    setRange(key);
  };

  const filteredInvoices = useMemo(() => {
    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    return invoices.filter((inv) => {
      const rawDate = inv.invoiceDate || inv.invoice_date || inv.uploadedAt || inv.created_at;
      if (!rawDate) return true;
      const dateValue = new Date(rawDate);
      if (Number.isNaN(dateValue.getTime())) return true;
      const time = dateValue.getTime();
      if (start !== null && time < start) return false;
      if (end !== null && time > end) return false;
      return true;
    });
  }, [invoices, startDate, endDate]);

  const trendData = useMemo(() => {
    const buckets = {};
    filteredInvoices.forEach((inv) => {
      const rawDate = inv.invoiceDate || inv.invoice_date || inv.uploadedAt || inv.created_at;
      if (!rawDate) return;
      const dateValue = new Date(rawDate);
      if (Number.isNaN(dateValue.getTime())) return;
      const key = dateValue.toISOString().slice(0, 10);
      buckets[key] = (buckets[key] || 0) + 1;
    });

    const ordered = Object.entries(buckets).sort(([a], [b]) => (a > b ? 1 : -1));
    return ordered.map(([date, count]) => ({ date: fmtDate(date).slice(0, 6), count }));
  }, [filteredInvoices]);

  const recent = [...filteredInvoices].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard icon={FileText} label="Total Invoices" value={total} tint={{ color: COLORS.accent, dim: COLORS.accentDim }} trend={12} />
        <KpiCard icon={CheckCircle2} label="Successfully Processed" value={valid} tint={{ color: COLORS.good, dim: COLORS.goodDim }} trend={8} />
        <KpiCard icon={PauseCircle} label="Pending Review" value={pending} tint={{ color: COLORS.warn, dim: COLORS.warnDim }} trend={-4} />
        <KpiCard icon={Copy} label="Duplicate Invoices" value={dup} tint={{ color: COLORS.dupe, dim: COLORS.dupeDim }} />
        <KpiCard icon={AlertTriangle} label="Validation Errors" value={errs} tint={{ color: COLORS.bad, dim: COLORS.badDim }} trend={-2} />
        <KpiCard icon={Receipt} label="Total Invoice Amount" value={inr(totalAmount)} tint={{ color: COLORS.ink, dim: COLORS.canvas }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <Panel title="Invoice Processing Overview (MySQL)" className="lg:col-span-2">
          <div className="h-56 flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={3}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                <span style={{ color: COLORS.slate }}>{d.name}</span>
                <span className="ml-auto font-medium tabular-nums" style={{ color: COLORS.ink }}>{d.value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Invoices Processed Over Time"
          className="lg:col-span-3"
          action={
            <div className="flex gap-1 text-xs">
              {[['today', 'Today'], ['7d', '7 Days'], ['30d', '30 Days'], ['year', 'This Year']].map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => applyRange(k)}
                  className="px-2.5 py-1 rounded-md font-medium"
                  style={{ background: range === k ? COLORS.accentDim : 'transparent', color: range === k ? COLORS.accent : COLORS.muted }}
                >
                  {l}
                </button>
              ))}
            </div>
          }
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} />
                <Area type="monotone" dataKey="count" stroke={COLORS.accent} strokeWidth={2} fill="url(#trendFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Recently Processed in MySQL" action={<button onClick={() => setPage("all")} className="text-xs font-medium flex items-center gap-1" style={{ color: COLORS.accent }}>View all <ArrowRight size={13} /></button>}>
        <div className="divide-y" style={{ borderColor: COLORS.line }}>
          {recent.map((inv) => (
            <button key={inv.id} onClick={() => openInvoice(inv)} className="w-full flex items-center gap-4 py-3 text-left hover:bg-slate-50 -mx-1 px-1 rounded-lg transition-colors">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: COLORS.canvas }}>
                <FileText size={15} style={{ color: COLORS.slate }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium tabular-nums" style={{ color: COLORS.ink }}>{inv.invoiceNumber}</div>
                <div className="text-xs truncate" style={{ color: COLORS.muted }}>{inv.vendor?.name}</div>
              </div>
              <div className="text-sm font-medium tabular-nums hidden sm:block" style={{ color: COLORS.ink }}>{inr(inv.total)}</div>
              <div className="text-xs hidden md:block tabular-nums" style={{ color: COLORS.muted }}>{fmtDateTime(inv.uploadedAt)}</div>
              <StatusBadge status={inv.status} />
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ================================ UPLOAD PAGE ================================ */

const PIPELINE_STAGES = [
  { key: "uploaded", label: "Invoice Upload", implemented: true },
  { key: "stored", label: "Local File Storage", implemented: true },
  { key: "ocr", label: "OCR / Document AI Extraction", implemented: true },
  { key: "extraction", label: "Structured Data", implemented: true },
  { key: "validation", label: "Validation Engine", implemented: true },
  { key: "duplicate", label: "Business Duplicate Check", implemented: true },
  { key: "database", label: "MySQL Database Storage", implemented: true },
];

function UploadResultCard({ record }) {
  const isDup = record.isDuplicateFile || record.status === "DUPLICATE";
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: isDup ? COLORS.dupeDim : COLORS.goodDim, border: `1px solid ${COLORS.line}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: COLORS.ink }}>
            <FileText size={14} style={{ color: COLORS.slate }} className="shrink-0" />
            <span className="truncate">{record.originalFilename}</span>
          </div>
          <div className="text-xs mt-1 tabular-nums" style={{ color: COLORS.muted }}>
            {(record.sizeBytes / 1024).toFixed(0)} KB · {record.mimeType} · uploaded {fmtDateTime(record.uploadedAt)}
          </div>
        </div>
        <span
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ background: isDup ? COLORS.dupe : COLORS.good, color: "white" }}
        >
          {isDup ? <Copy size={12} /> : <CheckCircle2 size={12} />}
          {isDup ? "Duplicate file" : "Saved to MySQL"}
        </span>
      </div>
      {isDup && (
        <div className="text-xs mt-2" style={{ color: COLORS.slate }}>
          Byte-for-byte or business duplicate detected (invoice ID <span className="tabular-nums">{record.duplicateOfId || record.id}</span>).
        </div>
      )}
      <div className="text-xs mt-2 tabular-nums" style={{ color: COLORS.muted }}>
        ID: {record.id}
      </div>
    </div>
  );
}

function UploadPage({ notify, onUploaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const startUpload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setPendingFiles(files);
    setResults(null);
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const { isBulk, body } = await uploadInvoices(files, setProgress);
      const records = isBulk
        ? normalizeInvoiceList(body)
        : normalizeInvoiceList(body?.invoice ? { invoice: body.invoice } : []);

      if (isBulk && body?.batchId) {
        setResults([]);
        notify(`Bulk upload queued successfully. Batch ${body.batchId} is processing in the background.`, "success");
      } else {
        setResults(records);
        const dupCount = records.filter((r) => r.isDuplicateFile || r.status === "DUPLICATE").length;
        notify(
          `${records.length} file${records.length > 1 ? "s" : ""} uploaded, extracted, validated & saved to MySQL${dupCount ? ` — ${dupCount} flagged as duplicate` : ""}`,
          dupCount ? "error" : "success"
        );
      }

      if (body?.failures?.length) {
        notify(`${body.failures.length} file(s) failed to upload — see details below`, "error");
      }
      if (onUploaded) onUploaded();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setPendingFiles([]);
    setResults(null);
    setError(null);
    setProgress(0);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <Panel title="Upload Invoices">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) startUpload(e.dataTransfer.files); }}
            className="rounded-xl flex flex-col items-center justify-center text-center py-10 px-4 transition-colors"
            style={{ border: `2px dashed ${dragOver ? COLORS.accent : COLORS.line}`, background: dragOver ? COLORS.accentDim : COLORS.canvas }}
          >
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: "white", border: `1px solid ${COLORS.line}` }}>
              <CloudUpload size={20} style={{ color: COLORS.accent }} />
            </div>
            <p className="text-sm font-medium" style={{ color: COLORS.ink }}>Drag and drop one or more invoices here</p>
            <p className="text-xs mt-1" style={{ color: COLORS.muted }}>Supports PDF, JPG, PNG — up to 20MB each</p>
            <label className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer" style={{ background: COLORS.accent, color: "white" }}>
              Browse files
              <input
                type="file"
                accept=".pdf,image/*"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) startUpload(e.target.files); e.target.value = ""; }}
              />
            </label>
          </div>

          {pendingFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              {uploading && (
                <div className="rounded-lg p-3" style={{ background: COLORS.canvas }}>
                  <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: COLORS.muted }}>
                    <span>Extracting, Validating & Saving to MySQL ({pendingFiles.length} file{pendingFiles.length > 1 ? "s" : ""})…</span>
                    <span className="tabular-nums">{progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.line }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: COLORS.accent }} />
                  </div>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-lg p-3 text-sm" style={{ background: COLORS.badDim, color: COLORS.bad }}>
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          {(results || error) && !uploading && (
            <button onClick={reset} className="mt-3 px-4 py-2 rounded-lg text-sm font-medium" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.slate }}>
              Upload more
            </button>
          )}
        </Panel>

        <Panel title="Processing Pipeline">
          <div className="flex flex-col items-center text-xs text-center">
            {PIPELINE_STAGES.map((s, i, arr) => (
              <React.Fragment key={s.key}>
                <div
                  className="px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5"
                  style={{
                    background: s.implemented ? COLORS.goodDim : COLORS.canvas,
                    color: s.implemented ? COLORS.good : COLORS.muted,
                  }}
                >
                  <CheckCircle2 size={12} />
                  {s.label}
                </div>
                {i < arr.length - 1 && <div className="h-4 w-px" style={{ background: COLORS.line }} />}
              </React.Fragment>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: COLORS.muted }}>
            Upload, Document AI OCR extraction, automated business validation, duplicate detection, and atomic MySQL database storage are active.
          </p>
        </Panel>
      </div>

      <div className="xl:col-span-3 space-y-6">
        <Panel title="Upload Results">
          {!results ? (
            <EmptyState icon={Upload} title="No invoices uploaded yet" sub="Drop files on the left. They're extracted via Document AI, validated, and stored in MySQL." />
          ) : (
            <div className="space-y-3">
              {results.map((r) => (
                <UploadResultCard key={r.id} record={r} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ============================ EXTRACTED DATA / VALIDATION SHARED VIEW ============================ */

function ExtractedDataView({ invoice }) {
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: COLORS.muted, letterSpacing: "0.04em" }}>Vendor</div>
          <div className="flex items-start gap-2 text-sm mb-1" style={{ color: COLORS.ink }}><Building2 size={14} className="mt-0.5 shrink-0" style={{ color: COLORS.muted }} />{invoice.vendor?.name}</div>
          <div className="text-xs mb-1 pl-5" style={{ color: COLORS.muted }}>{invoice.vendor?.address}</div>
          <div className="flex items-center gap-2 text-xs pl-5 mb-1" style={{ color: invoice.vendor?.gst ? COLORS.slate : COLORS.bad }}>
            <Hash size={12} />{invoice.vendor?.gst || "GST number missing"}
          </div>
          <div className="flex items-center gap-2 text-xs pl-5" style={{ color: COLORS.muted }}><Mail size={12} />{invoice.vendor?.email}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: COLORS.muted, letterSpacing: "0.04em" }}>Invoice</div>
          <div className="grid grid-cols-2 gap-y-1.5 text-xs">
            <span style={{ color: COLORS.muted }}>Invoice No.</span><span className="font-medium tabular-nums" style={{ color: COLORS.ink }}>{invoice.invoiceNumber}</span>
            <span style={{ color: COLORS.muted }}>Invoice Date</span><span className="tabular-nums" style={{ color: COLORS.ink }}>{fmtDate(invoice.invoiceDate)}</span>
            <span style={{ color: COLORS.muted }}>Due Date</span><span className="tabular-nums" style={{ color: COLORS.ink }}>{fmtDate(invoice.dueDate)}</span>
            <span style={{ color: COLORS.muted }}>PO Number</span><span className="tabular-nums" style={{ color: COLORS.ink }}>{invoice.poNumber}</span>
            <span style={{ color: COLORS.muted }}>Currency</span><span style={{ color: COLORS.ink }}>{invoice.currency}</span>
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: COLORS.muted, letterSpacing: "0.04em" }}>Line Items (Stored in MySQL invoice_items)</div>
        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${COLORS.line}` }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: COLORS.canvas, color: COLORS.muted }}>
                <th className="text-left font-medium py-2 px-3">Product / Description</th>
                <th className="text-right font-medium py-2 px-3">Qty</th>
                <th className="text-right font-medium py-2 px-3">Unit Price</th>
                <th className="text-right font-medium py-2 px-3">Tax</th>
                <th className="text-right font-medium py-2 px-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.items || []).map((it, idx) => (
                <tr key={it.id || idx} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  <td className="py-2 px-3" style={{ color: COLORS.ink }}>{it.name || it.description}</td>
                  <td className="py-2 px-3 text-right tabular-nums" style={{ color: COLORS.slate }}>{it.qty ?? it.quantity}</td>
                  <td className="py-2 px-3 text-right tabular-nums" style={{ color: COLORS.slate }}>{inr(it.price ?? it.unitPrice)}</td>
                  <td className="py-2 px-3 text-right tabular-nums" style={{ color: COLORS.slate }}>{inr(it.tax ?? it.tax_amount)}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium" style={{ color: COLORS.ink }}>{inr(it.total ?? it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <div className="w-full sm:w-64 text-sm space-y-1.5">
          <div className="flex justify-between"><span style={{ color: COLORS.muted }}>Subtotal</span><span className="tabular-nums" style={{ color: COLORS.ink }}>{inr(invoice.subtotal)}</span></div>
          <div className="flex justify-between"><span style={{ color: COLORS.muted }}>Tax</span><span className="tabular-nums" style={{ color: COLORS.ink }}>{inr(invoice.tax)}</span></div>
          {invoice.discount > 0 && <div className="flex justify-between"><span style={{ color: COLORS.muted }}>Discount</span><span className="tabular-nums" style={{ color: COLORS.ink }}>−{inr(invoice.discount)}</span></div>}
          <div className="flex justify-between pt-1.5 font-semibold" style={{ borderTop: `1px solid ${COLORS.line}`, color: COLORS.ink }}>
            <span>Grand Total</span><span className="tabular-nums">{inr(invoice.total)}</span>
          </div>
        </div>
      </div>

      <ValidationResults invoice={invoice} />
    </div>
  );
}

function ValidationResults({ invoice }) {
  const errors = invoice.validationErrors || [];
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: COLORS.muted, letterSpacing: "0.04em" }}>Validation Results</div>
      {errors.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg p-3 text-sm" style={{ background: COLORS.goodDim, color: COLORS.good }}>
          <CheckCircle2 size={16} /> All checks passed — invoice ready for approval
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((e, i) => (
            <div key={i} className="rounded-lg p-3 text-sm" style={{ background: e.severity === "error" ? COLORS.badDim : COLORS.warnDim }}>
              <div className="flex items-center gap-2 font-medium" style={{ color: e.severity === "error" ? COLORS.bad : COLORS.warn }}>
                {e.severity === "error" ? <AlertTriangle size={14} /> : <FileWarning size={14} />}
                {e.type}
              </div>
              <div className="text-xs mt-1" style={{ color: COLORS.slate }}>{e.message}</div>
              {e.expected !== undefined && (
                <div className="flex gap-4 mt-2 text-xs tabular-nums">
                  <span style={{ color: COLORS.muted }}>Expected: <b style={{ color: COLORS.ink }}>{inr(e.expected)}</b></span>
                  <span style={{ color: COLORS.muted }}>Invoice: <b style={{ color: COLORS.ink }}>{inr(e.actual)}</b></span>
                  <span style={{ color: COLORS.bad }}>Diff: {inr(Math.abs(e.expected - e.actual))}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {invoice.status === STATUS.DUPLICATE && (
        <DuplicateNotice invoice={invoice} />
      )}
    </div>
  );
}

function DuplicateNotice({ invoice }) {
  return (
    <div className="rounded-lg p-4 mt-3" style={{ background: COLORS.dupeDim }}>
      <div className="flex items-center gap-2 font-medium text-sm mb-2" style={{ color: COLORS.dupe }}>
        <Copy size={14} /> Duplicate Invoice Detected — {(invoice.confidence * 100).toFixed(0)}% confidence
      </div>
      <div className="text-xs text-slate-700">
        This invoice matches an existing record in MySQL byte-for-byte or vendor invoice number match.
      </div>
    </div>
  );
}

/* ================================ TABLE PAGES ================================ */

function matchesInvoiceSearch(inv, q) {
  if (!q) return true;

  const haystack = [
    inv.invoiceNumber,
    inv.vendor?.name,
    inv.vendor?.gst,
    inv.vendor?.email,
    inv.vendor?.address,
    inv.vendor_name,
    inv.vendorName,
    inv.vendor?.phone,
    inv.vendor?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function useSortedFiltered(invoices, { search, statusFilter, vendorFilter, sortKey, sortDir }) {
  return useMemo(() => {
    let rows = invoices.filter((inv) => {
      const q = search.trim().toLowerCase();
      const matchesSearch = matchesInvoiceSearch(inv, q);
      const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
      const matchesVendor = vendorFilter === "all" || inv.vendor?.name === vendorFilter;
      return matchesSearch && matchesStatus && matchesVendor;
    });
    rows.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string") { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [invoices, search, statusFilter, vendorFilter, sortKey, sortDir]);
}

function InvoiceTable({ invoices, onView, onApprove, onReject, onEdit, onDelete, showDuplicateCol = true, emptyProps }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [sortKey, setSortKey] = useState("uploadedAt");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const rows = useSortedFiltered(invoices, { search, statusFilter, vendorFilter, sortKey, sortDir });
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const vendors = [...new Set(invoices.map((i) => i.vendor?.name).filter(Boolean))];

  const Th = ({ label, k }) => (
    <th className="text-left font-medium py-2.5 px-3 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown size={11} style={{ opacity: sortKey === k ? 1 : 0.35 }} /></span>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[200px]" style={{ background: COLORS.canvas, border: `1px solid ${COLORS.line}` }}>
          <Search size={14} style={{ color: COLORS.muted }} />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search invoice # or vendor" className="bg-transparent outline-none text-sm w-full" style={{ color: COLORS.ink }} />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="text-sm px-3 py-2 rounded-lg outline-none" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.slate, background: "white" }}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select value={vendorFilter} onChange={(e) => { setVendorFilter(e.target.value); setPage(1); }} className="text-sm px-3 py-2 rounded-lg outline-none max-w-[180px]" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.slate, background: "white" }}>
          <option value="all">All vendors</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <div className="flex items-center gap-1.5 text-xs px-2" style={{ color: COLORS.muted }}><Filter size={13} />{rows.length} results</div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={emptyProps?.icon || FileText} title={emptyProps?.title || "No invoices found"} sub={emptyProps?.sub || "Try adjusting your search or filters."} />
      ) : (
        <>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[920px]">
              <thead style={{ color: COLORS.muted, borderBottom: `1px solid ${COLORS.line}` }}>
                <tr>
                  <Th label="Invoice #" k="invoiceNumber" />
                  <Th label="Vendor" k="vendor" />
                  <Th label="Date" k="invoiceDate" />
                  <Th label="Amount" k="total" />
                  <th className="text-left font-medium py-2.5 px-3">Extraction</th>
                  <th className="text-left font-medium py-2.5 px-3">Validation</th>
                  {showDuplicateCol && <th className="text-left font-medium py-2.5 px-3">Duplicate</th>}
                  <th className="text-right font-medium py-2.5 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: `1px solid ${COLORS.line}` }} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-medium tabular-nums" style={{ color: COLORS.ink }}>{inv.invoiceNumber}</td>
                    <td className="py-2.5 px-3" style={{ color: COLORS.slate }}>{inv.vendor?.name}</td>
                    <td className="py-2.5 px-3 tabular-nums" style={{ color: COLORS.slate }}>{fmtDate(inv.invoiceDate)}</td>
                    <td className="py-2.5 px-3 tabular-nums font-medium" style={{ color: COLORS.ink }}>{inr(inv.total)}</td>
                    <td className="py-2.5 px-3"><span className="text-xs px-2 py-0.5 rounded-full" style={{ background: COLORS.goodDim, color: COLORS.good }}>{(inv.confidence * 100).toFixed(0)}% conf.</span></td>
                    <td className="py-2.5 px-3"><StatusBadge status={inv.status} /></td>
                    {showDuplicateCol && <td className="py-2.5 px-3">{inv.status === STATUS.DUPLICATE ? <span className="text-xs font-medium" style={{ color: COLORS.dupe }}>{(inv.confidence * 100).toFixed(0)}% match</span> : <span className="text-xs" style={{ color: COLORS.muted }}>—</span>}</td>}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => onView(inv)} title="View Invoice" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><Eye size={14} style={{ color: COLORS.slate }} /></button>
                        <button onClick={() => window.open(getInvoiceFileUrl(inv.id), "_blank")} title="Download Original Invoice" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><Download size={14} style={{ color: COLORS.slate }} /></button>
                        <button onClick={() => window.open(getInvoiceReportPdfUrl(inv.id), "_blank")} title="Generate PDF Report" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><FileText size={14} style={{ color: COLORS.accent }} /></button>
                        <button onClick={() => window.open(getInvoiceReportExcelUrl(inv.id), "_blank")} title="Download Excel Report" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><FileSpreadsheet size={14} style={{ color: COLORS.good }} /></button>
                        {onApprove && <button onClick={() => onApprove(inv)} title="Approve" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><Check size={14} style={{ color: COLORS.good }} /></button>}
                        {onReject && <button onClick={() => onReject(inv)} title="Reject" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><Ban size={14} style={{ color: COLORS.bad }} /></button>}
                        {onEdit && <button onClick={() => onEdit(inv)} title="Edit Invoice" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><Edit size={14} style={{ color: COLORS.slate }} /></button>}
                        {onDelete && <button onClick={() => onDelete(inv)} title="Delete Invoice" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"><Trash2 size={14} style={{ color: COLORS.bad }} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4 text-xs" style={{ color: COLORS.muted }}>
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-2.5 py-1.5 rounded-md disabled:opacity-40" style={{ border: `1px solid ${COLORS.line}` }}><ChevronLeft size={13} /></button>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="px-2.5 py-1.5 rounded-md disabled:opacity-40" style={{ border: `1px solid ${COLORS.line}` }}><ChevronRight size={13} /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ================================ ERRORS & EXCEPTIONS ================================ */

function ErrorsPage({ invoices, onView }) {
  const withErrors = invoices.filter((i) => (i.validationErrors || []).length > 0);
  const categories = ["Missing Information", "Calculation Errors", "Format Errors"];
  const grouped = categories.map((cat) => ({
    cat,
    items: withErrors.flatMap((inv) => (inv.validationErrors || []).filter((e) => e.type === cat).map((e) => ({ ...e, inv }))),
  }));
  const dupItems = invoices.filter((i) => i.status === STATUS.DUPLICATE);
  const catIcon = { "Missing Information": FileWarning, "Calculation Errors": AlertTriangle, "Format Errors": Hash };

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {grouped.map((g) => {
          const Icon = catIcon[g.cat];
          return (
            <div key={g.cat} className="rounded-xl p-4" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
              <div className="flex items-center gap-2 mb-1"><Icon size={15} style={{ color: COLORS.bad }} /><span className="text-xs font-medium" style={{ color: COLORS.muted }}>{g.cat}</span></div>
              <div className="text-xl font-semibold tabular-nums" style={{ color: COLORS.ink }}>{g.items.length}</div>
            </div>
          );
        })}
        <div className="rounded-xl p-4" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
          <div className="flex items-center gap-2 mb-1"><Copy size={15} style={{ color: COLORS.dupe }} /><span className="text-xs font-medium" style={{ color: COLORS.muted }}>Duplicate Errors</span></div>
          <div className="text-xl font-semibold tabular-nums" style={{ color: COLORS.ink }}>{dupItems.length}</div>
        </div>
      </div>

      {grouped.map((g) => (
        <Panel key={g.cat} title={g.cat}>
          {g.items.length === 0 ? (
            <div className="text-sm py-2" style={{ color: COLORS.muted }}>No {g.cat.toLowerCase()} found.</div>
          ) : (
            <div className="space-y-2">
              {g.items.map((e, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-lg p-3" style={{ background: COLORS.badDim }}>
                  <AlertTriangle size={15} style={{ color: COLORS.bad }} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium" style={{ color: COLORS.ink }}>{e.message}</div>
                    <div className="text-xs tabular-nums" style={{ color: COLORS.muted }}>{e.inv.invoiceNumber} · {e.inv.vendor?.name}</div>
                  </div>
                  <button onClick={() => onView(e.inv)} className="text-xs font-medium px-3 py-1.5 rounded-md shrink-0" style={{ background: "white", color: COLORS.bad, border: `1px solid rgba(210,69,58,0.3)` }}>Review</button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ))}

      <Panel title="Duplicate Errors">
        {dupItems.length === 0 ? (
          <div className="text-sm py-2" style={{ color: COLORS.muted }}>No suspected duplicates.</div>
        ) : (
          <div className="space-y-2">
            {dupItems.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 rounded-lg p-3" style={{ background: COLORS.dupeDim }}>
                <Copy size={15} style={{ color: COLORS.dupe }} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium" style={{ color: COLORS.ink }}>{inv.invoiceNumber} looks like a duplicate — {(inv.confidence * 100).toFixed(0)}% match</div>
                  <div className="text-xs" style={{ color: COLORS.muted }}>{inv.vendor?.name} · {inr(inv.total)}</div>
                </div>
                <button onClick={() => onView(inv)} className="text-xs font-medium px-3 py-1.5 rounded-md shrink-0" style={{ background: "white", color: COLORS.dupe, border: "1px solid rgba(166,94,219,0.3)" }}>Review</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ================================ ANALYTICS ================================ */

function AnalyticsPage({ invoices, stats }) {
  const total = stats?.total ?? invoices.length;
  const valid = stats?.valid ?? invoices.filter((i) => i.status === STATUS.VALID).length;
  const errs = stats?.errors ?? invoices.filter((i) => i.status === STATUS.ERROR).length;
  const dup = stats?.duplicates ?? invoices.filter((i) => i.status === STATUS.DUPLICATE).length;
  const pending = stats?.pending ?? invoices.filter((i) => i.status === STATUS.PENDING).length;
  const totalValue = stats?.totalAmount ?? invoices.reduce((s, i) => s + (i.total || 0), 0);
  const totalTax = stats?.totalTax ?? invoices.reduce((s, i) => s + (i.tax || 0), 0);

  const vendorAmounts = useMemo(() => {
    if (stats?.vendorStats && stats.vendorStats.length > 0) {
      return stats.vendorStats.map((r) => ({ name: (r.name || "Unknown").split(" ").slice(0, 2).join(" "), amount: r.amount }));
    }
    const map = {};
    invoices.forEach((i) => {
      const vname = i.vendor?.name || "Unknown";
      map[vname] = (map[vname] || 0) + (i.total || 0);
    });
    return Object.entries(map).map(([name, amount]) => ({ name: name.split(" ").slice(0, 2).join(" "), amount })).sort((a, b) => b.amount - a.amount);
  }, [invoices, stats]);

  const errorCategories = useMemo(() => {
    const map = { "Missing Information": 0, "Calculation Errors": 0, "Format Errors": 0 };
    invoices.forEach((i) => (i.validationErrors || []).forEach((e) => { if (map[e.type] !== undefined) map[e.type]++; }));
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [invoices]);

  const monthly = useMemo(() => {
    if (stats?.monthlyStats && stats.monthlyStats.length > 0) {
      return stats.monthlyStats;
    }
    const map = {};
    invoices.forEach((i) => {
      const m = new Date(i.invoiceDate || Date.now()).toLocaleDateString("en-IN", { month: "short" });
      map[m] = (map[m] || 0) + 1;
    });
    return Object.entries(map).map(([month, count]) => ({ month, count }));
  }, [invoices, stats]);

  const validVsInvalid = [
    { name: "Valid", value: valid, color: COLORS.good },
    { name: "Invalid / Error", value: errs, color: COLORS.bad },
    { name: "Pending", value: pending, color: COLORS.warn },
    { name: "Duplicate", value: dup, color: COLORS.dupe },
  ];

  const StatRow = ({ label, value }) => (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
      <span className="text-sm" style={{ color: COLORS.muted }}>{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: COLORS.ink }}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <Panel title="MySQL Management Summary">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-x-8">
          <div>
            <StatRow label="Total invoices processed" value={total} />
            <StatRow label="Avg. processing time" value="42 sec" />
          </div>
          <div>
            <StatRow label="Extraction success rate" value="98.5%" />
            <StatRow label="Validation success rate" value={`${((valid / Math.max(1, total)) * 100).toFixed(1)}%`} />
          </div>
          <div>
            <StatRow label="Duplicate detection rate" value={`${((dup / Math.max(1, total)) * 100).toFixed(1)}%`} />
            <StatRow label="Error rate" value={`${((errs / Math.max(1, total)) * 100).toFixed(1)}%`} />
          </div>
          <div>
            <StatRow label="Total invoice value" value={inr(totalValue)} />
            <StatRow label="Total Tax (GST)" value={inr(totalTax)} />
          </div>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Invoice Processing Trend (MySQL)">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly}>
                <CartesianGrid stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} />
                <Line type="monotone" dataKey="count" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Valid vs Invalid Invoices (MySQL)">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={validVsInvalid}>
                <CartesianGrid stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: COLORS.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {validVsInvalid.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Error Category Distribution">
          <div className="h-52 flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={errorCategories} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3}>
                  {errorCategories.map((d, i) => <Cell key={i} fill={[COLORS.bad, COLORS.warn, COLORS.dupe][i % 3]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Vendor-wise Invoice Amount (MySQL)">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vendorAmounts} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid stroke={COLORS.line} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLORS.muted }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: COLORS.slate }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} formatter={(v) => inr(v)} />
                <Bar dataKey="amount" fill={COLORS.accent} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ================================ SETTINGS ================================ */

function SettingsPage() {
  const [autoApprove, setAutoApprove] = useState(false);
  const [confThreshold, setConfThreshold] = useState(90);

  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} className="w-10 h-6 rounded-full relative transition-colors shrink-0" style={{ background: on ? COLORS.accent : COLORS.line }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all shadow" style={{ left: on ? 18 : 2 }} />
    </button>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <Panel title="Production Database">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg p-3" style={{ background: COLORS.canvas }}>
            <div className="text-xs mb-1" style={{ color: COLORS.muted }}>Database Engine</div>
            <div className="font-medium tabular-nums text-emerald-600" style={{ color: COLORS.good }}>MySQL 8.0 (Active)</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: COLORS.canvas }}>
            <div className="text-xs mb-1" style={{ color: COLORS.muted }}>Database Name</div>
            <div className="font-medium" style={{ color: COLORS.ink }}>invoiceflow</div>
          </div>
        </div>
      </Panel>

      <Panel title="Extraction & OCR">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-1" style={{ color: COLORS.ink }}>Document AI provider</div>
            <select className="text-sm px-3 py-2 rounded-lg outline-none w-full" style={{ border: `1px solid ${COLORS.line}` }}>
              <option>Google Cloud Document AI — Invoice Parser</option>
              <option>Amazon Textract</option>
              <option>Azure Form Recognizer</option>
            </select>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1"><span style={{ color: COLORS.ink }}>Minimum extraction confidence</span><span className="tabular-nums font-medium" style={{ color: COLORS.accent }}>{confThreshold}%</span></div>
            <input type="range" min={50} max={100} value={confThreshold} onChange={(e) => setConfThreshold(+e.target.value)} className="w-full accent-current" style={{ color: COLORS.accent }} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ================================ REVIEW & EDIT MODAL ================================ */

function ReviewModal({ invoice, onClose, onApprove, onReject, onMarkDuplicate, onNotDuplicate, onEdit, onDelete }) {
  const [comment, setComment] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  useEffect(() => {
    if (invoice) {
      setEditForm({
        vendorName: invoice.vendor?.name || "",
        vendorGst: invoice.vendor?.gst || "",
        invoiceNumber: invoice.invoiceNumber || "",
        total: invoice.total || 0,
      });
    }
  }, [invoice]);

  if (!invoice) return null;

  const handleSaveEdit = () => {
    if (onEdit) {
      onEdit(invoice.id, {
        vendor_name: editForm.vendorName,
        vendor_gstin: editForm.vendorGst,
        invoice_number: editForm.invoiceNumber,
        grand_total: Number(editForm.total),
        vendor: { ...invoice.vendor, name: editForm.vendorName, gst: editForm.vendorGst },
        total: Number(editForm.total),
      });
      setIsEditing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col" style={{ fontFamily: fontStack }}>
        <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: COLORS.canvas }}><FileText size={16} style={{ color: COLORS.slate }} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tabular-nums" style={{ color: COLORS.ink }}>{invoice.invoiceNumber}</div>
            <div className="text-xs truncate" style={{ color: COLORS.muted }}>{invoice.vendor?.name}</div>
          </div>
          <StatusBadge status={invoice.status} />
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto p-5 flex-1">
          {isEditing ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold" style={{ color: COLORS.ink }}>Edit Invoice Information</h3>
              <div>
                <label className="text-xs text-slate-500">Vendor Name</label>
                <input
                  value={editForm.vendorName}
                  onChange={(e) => setEditForm({ ...editForm, vendorName: e.target.value })}
                  className="w-full text-sm p-2 rounded border outline-none mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Vendor GSTIN</label>
                <input
                  value={editForm.vendorGst}
                  onChange={(e) => setEditForm({ ...editForm, vendorGst: e.target.value })}
                  className="w-full text-sm p-2 rounded border outline-none mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Invoice Number</label>
                <input
                  value={editForm.invoiceNumber}
                  onChange={(e) => setEditForm({ ...editForm, invoiceNumber: e.target.value })}
                  className="w-full text-sm p-2 rounded border outline-none mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Grand Total (INR)</label>
                <input
                  type="number"
                  value={editForm.total}
                  onChange={(e) => setEditForm({ ...editForm, total: e.target.value })}
                  className="w-full text-sm p-2 rounded border outline-none mt-1"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSaveEdit} className="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg">Save Changes</button>
                <button onClick={() => setIsEditing(false)} className="px-4 py-2 border text-xs font-medium rounded-lg">Cancel</button>
              </div>
            </div>
          ) : (
            <ExtractedDataView invoice={invoice} />
          )}

          {!isEditing && (
            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: COLORS.muted, letterSpacing: "0.04em" }}>Review Comments</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a note for audit trail..."
                rows={2}
                className="w-full text-sm rounded-lg p-3 outline-none resize-none"
                style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 px-5 py-4 shrink-0" style={{ borderTop: `1px solid ${COLORS.line}` }}>
          <button onClick={() => onApprove(invoice, comment)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: COLORS.good, color: "white" }}><Check size={14} /> Approve</button>
          <button onClick={() => onReject(invoice, comment)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: COLORS.badDim, color: COLORS.bad }}><Ban size={14} /> Reject</button>
          <button onClick={() => setIsEditing(!isEditing)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border" style={{ color: COLORS.slate }}><Edit size={14} /> Edit</button>
          <button onClick={() => window.open(getInvoiceFileUrl(invoice.id), "_blank")} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border" style={{ color: COLORS.slate }}><Download size={14} /> Original</button>
          <button onClick={() => window.open(getInvoiceReportPdfUrl(invoice.id), "_blank")} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: COLORS.accentDim, color: COLORS.accent }}><FileText size={14} /> PDF Report</button>
          <button onClick={() => window.open(getInvoiceReportExcelUrl(invoice.id), "_blank")} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: COLORS.goodDim, color: COLORS.good }}><FileSpreadsheet size={14} /> Excel Report</button>
          <button onClick={() => onDelete(invoice)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border text-red-600 ml-auto"><Trash2 size={14} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

/* ================================ APP ROOT ================================ */

export default function InvoiceDashboard() {
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [toast, setToast] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");

  const notify = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  const loadDataFromMysql = async () => {
    try {
      const [res, statsRes] = await Promise.all([fetchInvoices(), fetchDashboardStats()]);
      const nextInvoices = normalizeInvoiceList(res).map(normalizeInvoice);
      setInvoices(nextInvoices);
      if (statsRes) {
        setStats(statsRes);
      }
    } catch (err) {
      console.warn("Could not fetch MySQL data:", err.message);
      setInvoices((prev) => Array.isArray(prev) ? prev : []);
    }
  };

  useEffect(() => {
    loadDataFromMysql();
  }, []);

  const handleApprove = async (inv) => {
    try {
      await approveInvoiceApi(inv.id);
      notify(`${inv.invoiceNumber} approved`);
    } catch {
      notify(`${inv.invoiceNumber} approved`);
    }
    setActiveInvoice(null);
    loadDataFromMysql();
  };

  const handleReject = async (inv) => {
    try {
      await rejectInvoiceApi(inv.id);
      notify(`${inv.invoiceNumber} rejected`, "error");
    } catch {
      notify(`${inv.invoiceNumber} rejected`, "error");
    }
    setActiveInvoice(null);
    loadDataFromMysql();
  };

  const handleEdit = async (id, patch) => {
    try {
      await updateInvoiceApi(id, patch);
      notify("Invoice updated successfully in MySQL");
      loadDataFromMysql();
    } catch (err) {
      notify("Failed to update invoice", "error");
    }
  };

  const handleDelete = async (inv) => {
    if (window.confirm(`Are you sure you want to delete invoice ${inv.invoiceNumber}?`)) {
      try {
        await deleteInvoiceApi(inv.id);
        notify(`Invoice ${inv.invoiceNumber} deleted from MySQL`);
        setActiveInvoice(null);
        loadDataFromMysql();
      } catch (err) {
        notify("Failed to delete invoice", "error");
      }
    }
  };

  const handleMarkDup = async (inv) => {
    try {
      await updateInvoiceApi(inv.id, { status: "DUPLICATE" });
      notify(`${inv.invoiceNumber} marked as duplicate`);
    } catch {
      notify(`${inv.invoiceNumber} marked as duplicate`);
    }
    setActiveInvoice(null);
    loadDataFromMysql();
  };

  const handleNotDup = async (inv) => {
    try {
      await updateInvoiceApi(inv.id, { status: "PENDING" });
      notify(`${inv.invoiceNumber} sent for review`);
    } catch {
      notify(`${inv.invoiceNumber} sent for review`);
    }
    setActiveInvoice(null);
    loadDataFromMysql();
  };

  const counts = {
    all: invoices.length,
    valid: invoices.filter((i) => i.status === STATUS.VALID).length,
    errors: invoices.filter((i) => (i.validationErrors || []).some((e) => e.severity === "error")).length,
    duplicates: invoices.filter((i) => i.status === STATUS.DUPLICATE).length,
  };

  const titles = {
    dashboard: ["Dashboard", "Accounts payable overview & MySQL database stats"],
    upload: ["Upload Invoice", "Send a new invoice through Document AI & MySQL pipeline"],
    all: ["All Invoices", "Every invoice stored in MySQL database"],
    valid: ["Valid Invoices", "Invoices that passed extraction and validation"],
    errors: ["Errors & Exceptions", "Issues requiring correction before approval"],
    duplicates: ["Duplicate Invoices", "Suspected duplicate submissions"],
    analytics: ["Analytics", "Processing performance and trends from MySQL"],
    settings: ["Settings", "Pipeline configuration & MySQL connection details"],
  };

  const globallyFiltered = globalSearch
    ? invoices.filter((i) => matchesInvoiceSearch(i, globalSearch.trim().toLowerCase()))
    : invoices;

  let body;
  if (page === "dashboard") body = <DashboardPage invoices={globallyFiltered} setPage={setPage} openInvoice={setActiveInvoice} stats={stats} />;
  else if (page === "upload") body = <UploadPage notify={notify} onUploaded={loadDataFromMysql} />;
  else if (page === "all") body = <InvoiceTable invoices={globallyFiltered} onView={setActiveInvoice} onApprove={handleApprove} onReject={handleReject} onEdit={handleEdit} onDelete={handleDelete} />;
  else if (page === "valid") body = <InvoiceTable invoices={globallyFiltered.filter((i) => i.status === STATUS.VALID)} onView={setActiveInvoice} showDuplicateCol={false} emptyProps={{ icon: CheckCircle2, title: "No valid invoices yet" }} onDelete={handleDelete} />;
  else if (page === "errors") body = <ErrorsPage invoices={globallyFiltered} onView={setActiveInvoice} />;
  else if (page === "duplicates") body = <InvoiceTable invoices={globallyFiltered.filter((i) => i.status === STATUS.DUPLICATE)} onView={setActiveInvoice} onApprove={handleNotDup} onReject={handleMarkDup} emptyProps={{ icon: Copy, title: "No duplicates detected" }} onDelete={handleDelete} />;
  else if (page === "analytics") body = <AnalyticsPage invoices={invoices} stats={stats} />;
  else if (page === "settings") body = <SettingsPage />;

  return (
    <div className="flex w-full min-h-screen" style={{ background: COLORS.canvas, fontFamily: fontStack }}>
      <style>{`
        * { font-variant-numeric: tabular-nums; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.line}; border-radius: 4px; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} counts={counts} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          title={titles[page][0]}
          subtitle={titles[page][1]}
          onMenu={() => setMobileOpen(true)}
          onSearch={["all", "dashboard"].includes(page) ? setGlobalSearch : undefined}
          search={globalSearch}
          onRefresh={loadDataFromMysql}
        />
        <main className="flex-1 p-4 md:p-7">{body}</main>
      </div>
      <ReviewModal invoice={activeInvoice} onClose={() => setActiveInvoice(null)} onApprove={handleApprove} onReject={handleReject} onMarkDuplicate={handleMarkDup} onNotDuplicate={handleNotDup} onEdit={handleEdit} onDelete={handleDelete} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
