"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, TrendingUp, TrendingDown, Home, DollarSign, Plus } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { SaleHistoryEntry } from "./SaleHistory";

export interface RentalHistoryEntry {
  date?: string;
  weeklyRent?: number;
  bond?: number;
  agency?: string;
  agentName?: string;
  daysOnMarket?: number;
  leaseTerm?: string;
  description?: string;
  source?: string;
}

type TimelineEvent =
  | ({ kind: "sale" } & SaleHistoryEntry)
  | ({ kind: "rental" } & RentalHistoryEntry);

type FilterTab = "all" | "sales" | "rentals";

const SALE_TYPE_LABELS: Record<string, string> = {
  "private-treaty": "Private Treaty",
  auction: "Auction",
  "expression-of-interest": "EOI",
  tender: "Tender",
  "off-market": "Off Market",
  unknown: "Unknown",
};

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
  } catch {
    return iso;
  }
}

function fmtYAxis(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function getEventDate(e: TimelineEvent): number {
  return e.date ? new Date(e.date).getTime() : 0;
}

function growthPercent(older: number, newer: number): number {
  return ((newer - older) / older) * 100;
}

/** A sale or lease the user records by hand; persisted via /api/property/[slug]/history. */
export interface NewHistoryRecord {
  kind: "sale" | "rental";
  /** YYYY-MM-DD */
  date: string;
  /** Sale price, or weekly rent for a lease */
  amount: number;
  agency?: string;
}

interface PropertyTimelineProps {
  sales: SaleHistoryEntry[];
  rentals: RentalHistoryEntry[];
  /** With onParse, a paste-to-add box is shown. Should throw on failure. */
  onAdd?: (record: NewHistoryRecord) => Promise<void>;
  /** Parses pasted history text into records for review (POST …/history/parse). */
  onParse?: (text: string) => Promise<ParsedHistoryRow[]>;
}

/** One row back from the parser; listings are shown but cannot be stored. */
export interface ParsedHistoryRow {
  kind: "sale" | "rental" | "listing";
  date: string;
  amount?: number;
  agency?: string;
}

const INPUT_CLASS =
  "h-10 w-full rounded-lg border border-[#E7E9EE] bg-white px-3 text-sm text-[#16181D] focus:border-[#2E5470] focus:outline-none focus:ring-2 focus:ring-[#2E5470]/20";

function AddRecordForm({
  onAdd,
  onParse,
}: {
  onAdd: (record: NewHistoryRecord) => Promise<void>;
  onParse: (text: string) => Promise<ParsedHistoryRow[]>;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E7E9EE] bg-white px-3 text-sm font-medium text-[#2E5470] transition-colors hover:bg-[#F4F5F7]"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add sale or lease records
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-[#E7E9EE] bg-white p-4">
      <PasteHistoryForm onAdd={onAdd} onParse={onParse} onDone={() => setOpen(false)} />
    </div>
  );
}

/** Paste an REA/Domain history panel → parse → tick rows → save each via onAdd. */
function PasteHistoryForm({
  onAdd,
  onParse,
  onDone,
}: {
  onAdd: (record: NewHistoryRecord) => Promise<void>;
  onParse: (text: string) => Promise<ParsedHistoryRow[]>;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<(ParsedHistoryRow & { checked: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await onParse(text);
      if (parsed.length === 0) setError("No sales or leases found in that text");
      setRows(parsed.map((r) => ({ ...r, checked: r.kind !== "listing" && !!r.amount })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse the text");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!rows) return;
    const todo = rows.filter((r) => r.checked && r.kind !== "listing" && r.amount);
    setBusy(true);
    setError(null);
    let saved = 0;
    try {
      for (const r of todo) {
        await onAdd({ kind: r.kind as "sale" | "rental", date: r.date, amount: r.amount!, agency: r.agency });
        saved++;
      }
      onDone();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Save failed"} (${saved} of ${todo.length} saved)`);
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<ParsedHistoryRow & { checked: boolean }>) =>
    setRows((prev) => prev && prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const selectable = rows?.filter((r) => r.checked && r.kind !== "listing" && r.amount).length ?? 0;

  return (
    <div aria-label="Paste property history">
      {!rows ? (
        <>
          <label className="text-xs font-medium text-[#6B7077]">
            Sales and leases (paste from realestate.com.au, Domain, PriceFinder, or type one)
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"Paste the full history panel, or one line like:\nSold $850,000 12 Mar 2024 by Grant's Estate Agents\nLeased $650 pw 3 Mar 2024"}
              className={`${INPUT_CLASS} mt-1 h-auto py-2 font-mono text-xs`}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={parse}
              className="h-10 rounded-lg bg-[#2E5470] px-4 text-sm font-medium text-white transition-colors hover:bg-[#24435A] disabled:opacity-60"
            >
              {busy ? "Parsing…" : "Parse"}
            </button>
            <button type="button" onClick={onDone} className="h-10 rounded-lg px-4 text-sm font-medium text-[#6B7077] hover:text-[#33363D]">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-medium text-[#6B7077]">
              <tr>
                <th className="pb-2 pr-2"><span className="sr-only">Save</span></th>
                <th className="pb-2 pr-2">Record</th>
                <th className="pb-2 pr-2">Date</th>
                <th className="pb-2 pr-2">Amount ($)</th>
                <th className="pb-2">Agency</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const storable = r.kind !== "listing";
                return (
                  <tr key={i} className={storable ? "" : "text-[#9A9EA5]"}>
                    <td className="py-1 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`Save ${r.kind} ${r.date}`}
                        checked={r.checked && storable}
                        disabled={!storable}
                        onChange={(e) => update(i, { checked: e.target.checked })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      {storable ? (
                        <select value={r.kind} onChange={(e) => update(i, { kind: e.target.value as ParsedHistoryRow["kind"] })} className={`${INPUT_CLASS} h-8`}>
                          <option value="sale">Sale</option>
                          <option value="rental">Lease</option>
                        </select>
                      ) : (
                        "Listed (not stored)"
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input type="date" value={r.date} disabled={!storable} onChange={(e) => update(i, { date: e.target.value })} className={`${INPUT_CLASS} h-8`} />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={r.amount ?? ""}
                        disabled={!storable}
                        onChange={(e) => update(i, { amount: Number(e.target.value.replace(/[^0-9.]/g, "")) || undefined })}
                        className={`${INPUT_CLASS} h-8 tabular-nums`}
                      />
                    </td>
                    <td className="py-1">
                      <input type="text" value={r.agency ?? ""} disabled={!storable} onChange={(e) => update(i, { agency: e.target.value })} className={`${INPUT_CLASS} h-8`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || selectable === 0}
              onClick={save}
              className="h-10 rounded-lg bg-[#2E5470] px-4 text-sm font-medium text-white transition-colors hover:bg-[#24435A] disabled:opacity-60"
            >
              {busy ? "Saving…" : `Save ${selectable} record${selectable === 1 ? "" : "s"}`}
            </button>
            <button type="button" onClick={() => { setRows(null); setError(null); }} className="h-10 rounded-lg px-4 text-sm font-medium text-[#6B7077] hover:text-[#33363D]">
              Back
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[#C5544A]">
          {error}
        </p>
      )}
    </div>
  );
}

export function PropertyTimeline({ sales, rentals, onAdd, onParse }: PropertyTimelineProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const isEmpty = sales.length === 0 && rentals.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[#E7E9EE] bg-white px-6 py-12 text-center ">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F4F5F7]">
          <Home className="h-7 w-7 text-[#2E5470] opacity-70" aria-hidden="true" />
        </div>
        <p className="text-base font-medium text-[#33363D]">No property history found</p>
        <p className="mt-1 text-sm text-[#6B7077]">
          Sales and rental records will appear here when available.
        </p>
        {onAdd && onParse && (
          <div className="mt-5 w-full max-w-2xl text-left">
            <AddRecordForm onAdd={onAdd} onParse={onParse} />
          </div>
        )}
      </div>
    );
  }

  // Build merged event list sorted newest first
  const allEvents: TimelineEvent[] = [
    ...sales.map((s) => ({ kind: "sale" as const, ...s })),
    ...rentals.map((r) => ({ kind: "rental" as const, ...r })),
  ].sort((a, b) => getEventDate(b) - getEventDate(a));

  const filteredEvents = allEvents.filter((e) => {
    if (activeTab === "sales") return e.kind === "sale";
    if (activeTab === "rentals") return e.kind === "rental";
    return true;
  });

  // Chart data — sales only, oldest → newest
  const confirmedSales = [...sales]
    .filter((s) => !s.isConfidential && s.price != null && s.date)
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

  const chartData = confirmedSales.map((s) => ({
    date: fmtShortDate(s.date!),
    price: s.price!,
    fullDate: s.date!,
  }));

  // Growth calculation for each sale vs previous confirmed sale
  function getSaleGrowth(sale: SaleHistoryEntry): { pct: number; sinceYear: string } | null {
    if (!sale.price || sale.isConfidential || !sale.date) return null;
    const idx = confirmedSales.findIndex((s) => s.date === sale.date);
    if (idx <= 0) return null;
    const older = confirmedSales[idx - 1];
    return {
      pct: growthPercent(older.price!, sale.price),
      sinceYear: new Date(older.date!).getFullYear().toString(),
    };
  }

  const hasSales = sales.length > 0;
  const hasRentals = rentals.length > 0;

  return (
    <div className="space-y-4">
      {/* Price chart — sales only, 2+ confirmed entries */}
      {chartData.length >= 2 && (
        <div className="rounded-xl border border-[#E7E9EE] bg-white p-4 ">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[#8A8F97]">
            Sale Price History
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="timelineGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2E5470" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#2E5470" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E9EE" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#6B7077" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={fmtYAxis}
                tick={{ fontSize: 11, fill: "#6B7077" }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                formatter={(value: number) => [fmtCurrency(value), "Sale Price"]}
                labelFormatter={(_label: string, payload) => {
                  const entry = payload?.[0]?.payload as { fullDate?: string } | undefined;
                  if (entry?.fullDate) {
                    try { return fmtDate(entry.fullDate); } catch { return _label; }
                  }
                  return _label;
                }}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #E7E9EE",
                  fontSize: "13px",
                  fontFamily: "var(--font-body)",
                }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="#2E5470"
                strokeWidth={2}
                fill="url(#timelineGradient)"
                dot={{ fill: "#2E5470", r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "#24435A" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filter tabs */}
      {hasSales && hasRentals && (
        <div className="flex gap-1 rounded-lg bg-[#F4F5F7] p-1 w-fit">
          {(["all", "sales", "rentals"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                activeTab === tab
                  ? "bg-white text-[#16181D] "
                  : "text-[#6B7077] hover:text-[#33363D]"
              }`}
            >
              {tab === "all" ? "All" : tab === "sales" ? `Sales (${sales.length})` : `Rentals (${rentals.length})`}
            </button>
          ))}
        </div>
      )}

      {/* Events */}
      <div className="space-y-3">
        {filteredEvents.map((event, i) => (
          <motion.div
            key={i}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            className="flex gap-4"
          >
            {/* Left icon */}
            <div className="flex flex-col items-center pt-1">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  event.kind === "sale"
                    ? "bg-[#FBFBFC] text-[#2E5470]"
                    : "bg-[#E4EBF1] text-[#2E5470]"
                }`}
              >
                {event.kind === "sale" ? (
                  <DollarSign className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Home className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
              {i < filteredEvents.length - 1 && (
                <div className="mt-2 w-px flex-1 bg-[#E7E9EE]" style={{ minHeight: "1.5rem" }} />
              )}
            </div>

            {/* Card */}
            <div className="mb-3 flex-1 rounded-xl border border-[#E7E9EE] bg-white p-5 transition-shadow duration-200 hover:shadow-md">
              {event.kind === "sale" ? (
                <SaleEventCard event={event} growth={getSaleGrowth(event)} />
              ) : (
                <RentalEventCard event={event} />
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {onAdd && onParse && <AddRecordForm onAdd={onAdd} onParse={onParse} />}
    </div>
  );
}

function SaleEventCard({
  event,
  growth,
}: {
  event: SaleHistoryEntry;
  growth: { pct: number; sinceYear: string } | null;
}) {
  const saleTypeLabel = event.type ? (SALE_TYPE_LABELS[event.type] ?? event.type) : null;
  const isPositive = growth && growth.pct >= 0;

  return (
    <>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#2E5470]">
        Sale
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="text-xl font-bold text-[#16181D] tabular-nums"
            >
              {event.price != null && !event.isConfidential
                ? fmtCurrency(event.price)
                : "Price Withheld"}
            </span>
            {event.date && (
              <span className="text-sm text-[#6B7077]">{fmtDate(event.date)}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {saleTypeLabel && (
              <span className="inline-flex items-center rounded-full bg-[#E9EFEA] px-2.5 py-0.5 text-xs font-medium text-[#435548]">
                {saleTypeLabel}
              </span>
            )}
            {event.daysOnMarket != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {event.daysOnMarket} days on market
              </span>
            )}
            {event.isConfidential && (
              <span className="inline-flex items-center rounded-full bg-[#F5EEDD] px-2.5 py-0.5 text-xs font-medium text-[#8A6425]">
                Confidential
              </span>
            )}
          </div>
        </div>
        {growth !== null && (
          <div
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
              isPositive ? "bg-[#E4F1EB] text-[#2F8F6B]" : "bg-[#F7E7E5] text-[#C5544A]"
            }`}
            title={`Since ${growth.sinceYear}`}
          >
            {isPositive ? (
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-4 w-4" aria-hidden="true" />
            )}
            <span>
              {isPositive ? "+" : ""}
              {growth.pct.toFixed(1)}% since {growth.sinceYear}
            </span>
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {event.agency && <DetailRow label="Agency" value={event.agency} />}
        {event.agentName && <DetailRow label="Agent" value={event.agentName} />}
        {event.listingPrice != null && !event.isConfidential && (
          <DetailRow label="Listed at" value={fmtCurrency(event.listingPrice)} />
        )}
        {event.settlementDate && (
          <DetailRow label="Settled" value={fmtDate(event.settlementDate)} />
        )}
      </div>
      {event.description && (
        <p className="mt-2 line-clamp-2 text-sm italic text-[#6B7077]">
          {event.description}
        </p>
      )}
      {event.source && (
        <p className="mt-3 text-xs text-[#8A8F97]">Source: {event.source}</p>
      )}
    </>
  );
}

function RentalEventCard({ event }: { event: RentalHistoryEntry }) {
  return (
    <>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#2E5470]">
        Rental Listing
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="text-xl font-bold text-[#16181D] tabular-nums"
        >
          {event.weeklyRent != null ? `${fmtCurrency(event.weeklyRent)}/wk` : "Rent N/A"}
        </span>
        {event.date && (
          <span className="text-sm text-[#6B7077]">{fmtDate(event.date)}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {event.leaseTerm && (
          <span className="inline-flex items-center rounded-full bg-[#E4EBF1] px-2.5 py-0.5 text-xs font-medium text-[#2E5470]">
            {event.leaseTerm}
          </span>
        )}
        {event.daysOnMarket != null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {event.daysOnMarket} days on market
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {event.agency && <DetailRow label="Agency" value={event.agency} />}
        {event.agentName && <DetailRow label="Manager" value={event.agentName} />}
        {event.bond != null && (
          <DetailRow label="Bond" value={fmtCurrency(event.bond)} />
        )}
      </div>
      {event.description && (
        <p className="mt-2 line-clamp-2 text-sm italic text-[#6B7077]">
          {event.description}
        </p>
      )}
      {event.source && (
        <p className="mt-3 text-xs text-[#8A8F97]">Source: {event.source}</p>
      )}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-[#8A8F97]">{label}</span>
      <span className="font-medium text-[#33363D]">{value}</span>
    </div>
  );
}
