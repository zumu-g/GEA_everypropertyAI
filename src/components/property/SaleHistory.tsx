"use client";

import { motion } from "framer-motion";
import { Calendar, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { SaleRecord } from "@/types/property";

interface SaleHistoryProps {
  sales: SaleRecord[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatShortYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    month: "short",
    year: "2-digit",
  });
}

function saleTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    "private-treaty": "Private Treaty",
    auction: "Auction",
    "expression-of-interest": "EOI",
    tender: "Tender",
    "off-market": "Off Market",
    unknown: "Unknown",
  };
  return labels[type] ?? type;
}

export function SaleHistory({ sales }: SaleHistoryProps) {
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  if (sales.length === 0) return null;

  // Chart data: oldest to newest
  const chartData = [...sales]
    .filter((s) => !s.isConfidential)
    .sort(
      (a, b) =>
        new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime()
    )
    .map((s) => ({
      date: formatShortYear(s.saleDate),
      price: s.price.amount,
    }));

  return (
    <section>
      <h2 className="mb-6 text-2xl font-bold text-gray-900">Sale History</h2>

      {/* Chart */}
      {chartData.length >= 2 && (
        <div className="mb-8 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
            >
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) =>
                  `$${(v / 1_000_000).toFixed(1)}M`
                }
                tick={{ fontSize: 12, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                formatter={(value: number) => [formatCurrency(value), "Price"]}
                contentStyle={{
                  borderRadius: "0.75rem",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                }}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={{ fill: "#2563eb", r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "#1d4ed8" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-3">
        {sales.map((sale, i) => (
          <motion.div
            key={sale.id}
            initial={prefersReducedMotion ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.07 }}
            className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
              <Calendar className="h-5 w-5 text-brand-600" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-bold text-gray-900">
                  {sale.isConfidential
                    ? "Confidential"
                    : formatCurrency(sale.price.amount)}
                </span>
                <span className="text-sm text-gray-500">
                  {formatDate(sale.saleDate)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {saleTypeLabel(sale.saleType)}
                </span>
                {sale.daysOnMarket != null && (
                  <span>{sale.daysOnMarket} days on market</span>
                )}
                {sale.agency && <span>via {sale.agency}</span>}
              </div>
            </div>
            {!sale.isConfidential && (
              <TrendingUp
                className="h-5 w-5 shrink-0 text-gray-300"
                aria-hidden="true"
              />
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
}
