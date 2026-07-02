"use client";

import { Loader2 } from "lucide-react";
import type { Valuation } from "@/types/property";

interface PriceEstimatePanelProps {
  valuation: Valuation | undefined;
}

const FMT = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function fmtPrice(n: number): string {
  return FMT.format(n);
}

/** Abbreviate large numbers: $850,000 → $850k, $1,200,000 → $1.2m */
function abbreviatePrice(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}m`;
  }
  if (n >= 1_000) {
    return `$${Math.round(n / 1_000)}k`;
  }
  return `$${n}`;
}

const CONFIDENCE_STYLES: Record<
  string,
  { badge: string; label: string }
> = {
  high:     { badge: "bg-[#E4F1EB] text-[#2F8F6B]", label: "High confidence" },
  "very-high": { badge: "bg-[#E4F1EB] text-[#2F8F6B]", label: "Very high confidence" },
  medium:   { badge: "bg-[#F5EEDD] text-[#8A6425]",   label: "Medium confidence" },
  low:      { badge: "bg-[#F7E7E5] text-[#C5544A]",        label: "Low confidence" },
  "very-low":  { badge: "bg-[#F7E7E5] text-[#C5544A]",    label: "Very low confidence" },
};

function ConfidenceBadge({ level }: { level: string }) {
  const style = CONFIDENCE_STYLES[level] ?? CONFIDENCE_STYLES["medium"];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
      {style.label}
    </span>
  );
}

export function PriceEstimatePanel({ valuation }: PriceEstimatePanelProps) {
  if (!valuation) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-[#E7E9EE] bg-white px-6 py-5 ">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#2E5470]" aria-hidden="true" />
        <p className="text-sm text-[#6B7077]">
          Valuation pending enrichment data
        </p>
      </div>
    );
  }

  const low  = valuation.lowRange.amount;
  const mid  = valuation.estimatedValue.amount;
  const high = valuation.highRange.amount;

  return (
    <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
      {/* Header row */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h3
          className="text-2xl font-semibold tracking-tight text-[#16181D]"
        >
          Estimated Value
        </h3>
        <ConfidenceBadge level={valuation.confidence.level} />
      </div>

      {/* Range display */}
      <div className="flex items-end justify-center gap-4 sm:gap-8">
        {/* Low */}
        <div className="flex-1 text-center">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#8A8F97]">
            Low
          </p>
          <p
            className="text-xl font-semibold tabular-nums text-[#6B7077]"
          >
            {abbreviatePrice(low)}
          </p>
        </div>

        {/* Mid — prominent */}
        <div className="flex-1 text-center">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#2E5470]">
            Estimate
          </p>
          <p
            className="text-4xl font-semibold tabular-nums text-[#2E5470]"
          >
            {fmtPrice(mid)}
          </p>
        </div>

        {/* High */}
        <div className="flex-1 text-center">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#8A8F97]">
            High
          </p>
          <p
            className="text-xl font-semibold tabular-nums text-[#6B7077]"
          >
            {abbreviatePrice(high)}
          </p>
        </div>
      </div>

      {/* Compact range label below */}
      <p className="mt-3 text-center text-sm font-medium text-[#6B7077]">
        {abbreviatePrice(low)}{" "}
        <span className="text-[#2E5470]">–</span>{" "}
        {abbreviatePrice(high)}
      </p>

      {/* Gauge bar */}
      <div className="relative mt-5 h-2.5 overflow-hidden rounded-full bg-[#F4F5F7]">
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#E7E9EE] via-[#2E5470] to-[#E7E9EE]" />
        <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#2E5470] bg-white shadow-md" />
      </div>

      {/* Valuation date */}
      {valuation.valuationDate && (
        <p className="mt-3 text-center text-xs text-[#8A8F97]">
          Valued{" "}
          {new Date(valuation.valuationDate).toLocaleDateString("en-AU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          {" · "}
          {valuation.source.name}
        </p>
      )}

      {/* Methodology note */}
      {valuation.confidence.reasoning && (
        <p className="mt-3 text-center text-xs leading-relaxed text-[#8A8F97]">
          {valuation.confidence.reasoning}
        </p>
      )}
    </div>
  );
}
