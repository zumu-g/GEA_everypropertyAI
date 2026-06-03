"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, TrendingUp, TrendingDown, Home, DollarSign } from "lucide-react";
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

interface PropertyTimelineProps {
  sales: SaleHistoryEntry[];
  rentals: RentalHistoryEntry[];
}

export function PropertyTimeline({ sales, rentals }: PropertyTimelineProps) {
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
          <Home className="h-7 w-7 text-[#C8A96E] opacity-70" aria-hidden="true" />
        </div>
        <p className="text-base font-medium text-[#33363D]">No property history found</p>
        <p className="mt-1 text-sm text-[#6B7077]">
          Sales and rental records will appear here when available.
        </p>
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
                  <stop offset="5%" stopColor="#335C7D" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#335C7D" stopOpacity={0} />
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
                stroke="#335C7D"
                strokeWidth={2}
                fill="url(#timelineGradient)"
                dot={{ fill: "#335C7D", r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "#B8954A" }}
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
                    ? "bg-[#FBFBFC] text-[#C8A96E]"
                    : "bg-[#E4EBF1] text-[#335C7D]"
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
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#C8A96E]">
        Sale
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="text-xl font-bold text-[#16181D] tabular-nums"
              style={{ fontFamily: "var(--font-mono)" }}
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
              <span className="inline-flex items-center rounded-full bg-[#FBFBFC] px-2.5 py-0.5 text-xs font-medium text-[#B8954A]">
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
              <span className="inline-flex items-center rounded-full bg-[#F5EEDD] px-2.5 py-0.5 text-xs font-medium text-[#B8954A]">
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
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#335C7D]">
        Rental Listing
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="text-xl font-bold text-[#16181D] tabular-nums"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {event.weeklyRent != null ? `${fmtCurrency(event.weeklyRent)}/wk` : "Rent N/A"}
        </span>
        {event.date && (
          <span className="text-sm text-[#6B7077]">{fmtDate(event.date)}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {event.leaseTerm && (
          <span className="inline-flex items-center rounded-full bg-[#E4EBF1] px-2.5 py-0.5 text-xs font-medium text-[#335C7D]">
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
