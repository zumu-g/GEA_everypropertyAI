"use client";

import { motion } from "framer-motion";
import { Clock, TrendingUp, TrendingDown, Home } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface SaleHistoryEntry {
  date?: string;
  price?: number;
  type?: string;
  agency?: string;
  agentName?: string;
  daysOnMarket?: number;
  listingPrice?: number;
  isConfidential?: boolean;
  description?: string;
  settlementDate?: string;
  source?: string;
}

interface SaleHistoryProps {
  sales: SaleHistoryEntry[];
}

const SALE_TYPE_LABELS: Record<string, string> = {
  "private-treaty":       "Private Treaty",
  auction:                "Auction",
  "expression-of-interest": "EOI",
  tender:                 "Tender",
  "off-market":           "Off Market",
  unknown:                "Unknown",
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

/** Calculate the percent change between two prices. Returns null if either is undefined. */
function growthPercent(older: number, newer: number): number {
  return ((newer - older) / older) * 100;
}

export function SaleHistory({ sales }: SaleHistoryProps) {
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  if (sales.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[#E7E9EE] bg-white px-6 py-12 text-center ">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F4F5F7]">
          <Home className="h-7 w-7 text-[#2E5470] opacity-70" aria-hidden="true" />
        </div>
        <p className="text-base font-medium text-[#33363D]">No sale history found</p>
        <p className="mt-1 text-sm text-[#6B7077]">
          Sales records will appear here when they become available.
        </p>
      </div>
    );
  }

  // Sort oldest → newest for chart; newest → oldest for card display
  const sorted = [...sales].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return da - db;
  });

  const chartData = sorted
    .filter((s) => !s.isConfidential && s.price != null && s.date)
    .map((s) => ({
      date: fmtShortDate(s.date!),
      price: s.price!,
      fullDate: s.date!,
    }));

  // Display: newest first
  const displaySales = [...sales].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  // Precompute growth deltas vs the next-most-recent confirmed sale
  const confirmedPrices = sorted
    .filter((s) => !s.isConfidential && s.price != null)
    .map((s) => ({ date: s.date!, price: s.price! }));

  function getGrowthVsPrevious(sale: SaleHistoryEntry): {
    pct: number;
    sinceYear: string;
  } | null {
    if (!sale.price || sale.isConfidential || !sale.date) return null;
    const idx = confirmedPrices.findIndex((p) => p.date === sale.date);
    if (idx <= 0) return null; // oldest entry or not found
    const older = confirmedPrices[idx - 1];
    return {
      pct: growthPercent(older.price, sale.price),
      sinceYear: new Date(older.date).getFullYear().toString(),
    };
  }

  return (
    <div className="space-y-4">
      {/* Price chart — only when 2+ confirmed entries */}
      {chartData.length >= 2 && (
        <div className="rounded-xl border border-[#E7E9EE] bg-white p-4 ">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 16, left: 8, bottom: 0 }}
            >
              <defs>
                <linearGradient id="saleHistoryGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#2E5470" stopOpacity={0.15} />
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
                    try {
                      return fmtDate(entry.fullDate);
                    } catch {
                      return _label;
                    }
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
                fill="url(#saleHistoryGradient)"
                dot={{ fill: "#2E5470", r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "#24435A" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sale cards */}
      <div className="space-y-3">
        {displaySales.map((sale, i) => {
          const growth = getGrowthVsPrevious(sale);
          const isPositive = growth && growth.pct >= 0;
          const saleTypeLabel = sale.type
            ? (SALE_TYPE_LABELS[sale.type] ?? sale.type)
            : null;

          return (
            <motion.div
              key={i}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06 }}
              className="rounded-xl border border-[#E7E9EE] bg-white p-5 transition-shadow duration-200 hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {/* Left: price + date */}
                <div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="text-xl font-bold text-[#16181D] tabular-nums"
                    >
                      {sale.price != null && !sale.isConfidential
                        ? fmtCurrency(sale.price)
                        : "Price Withheld"}
                    </span>
                    {sale.date && (
                      <span className="text-sm text-[#6B7077]">
                        {fmtDate(sale.date)}
                      </span>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {saleTypeLabel && (
                      <span className="inline-flex items-center rounded-full bg-[#E9EFEA] px-2.5 py-0.5 text-xs font-medium text-[#435548]">
                        {saleTypeLabel}
                      </span>
                    )}
                    {sale.daysOnMarket != null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {sale.daysOnMarket} days on market
                      </span>
                    )}
                    {sale.isConfidential && (
                      <span className="inline-flex items-center rounded-full bg-[#F5EEDD] px-2.5 py-0.5 text-xs font-medium text-[#8A6425]">
                        Confidential
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: growth indicator */}
                {growth !== null && (
                  <div
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
                      isPositive
                        ? "bg-[#E4F1EB] text-[#2F8F6B]"
                        : "bg-[#F7E7E5] text-[#C5544A]"
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

              {/* Details grid */}
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {sale.agency && (
                  <DetailRow label="Agency" value={sale.agency} />
                )}
                {sale.agentName && (
                  <DetailRow label="Agent" value={sale.agentName} />
                )}
                {sale.listingPrice != null && !sale.isConfidential && (
                  <DetailRow label="Listed at" value={fmtCurrency(sale.listingPrice)} />
                )}
                {sale.settlementDate && (
                  <DetailRow label="Settled" value={fmtDate(sale.settlementDate)} />
                )}
              </div>

              {sale.description && (
                <p className="mt-2 line-clamp-2 text-sm italic text-[#6B7077]">
                  {sale.description}
                </p>
              )}

              {/* Source attribution */}
              {sale.source && (
                <p className="mt-3 text-xs text-[#8A8F97]">
                  Source: {sale.source}
                </p>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
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
