"use client";

import Image from "next/image";
import Link from "next/link";
import { Home } from "lucide-react";
import { parseAddress } from "@/lib/utils/address";
import { formatLandArea } from "@/lib/utils/area";
import { isOptimizerBlocked } from "@/lib/utils/image";
import type { WeightedRentalComp } from "@/lib/estimation/rental-comparables-estimator";

export interface ComparableRentalsProps {
  /** Weighted comps from the /api/estimate-rent result (comparablesUsed). */
  comps: WeightedRentalComp[];
}

const MAX_CARDS = 4;

function fmtRent(weekly: number): string {
  return `$${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 }).format(weekly)}/wk`;
}

function fmtDate(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** Same structured-href behaviour as ComparableSales.comparableHref, adapted to
 * rental comps: `suburb` is optional on WeightedRentalComp, so the suburb
 * append/re-parse only runs when a suburb is present. */
function rentalHref(comp: WeightedRentalComp): string {
  let structured = parseAddress(comp.rawAddress);
  if (comp.suburb && structured.suburb.toLowerCase() !== comp.suburb.toLowerCase()) {
    structured = parseAddress(`${comp.rawAddress}, ${comp.suburb}`);
  }
  if (!structured.state) structured.state = "VIC";
  return `/property?address=${encodeURIComponent(JSON.stringify(structured))}`;
}

/** Match badge on the weight-normalised 0-100 scale (top comp = 100). The
 * sales badge's 130/110 colour breakpoints are unreachable after
 * normalisation, so this badge uses its own thresholds. */
function MatchBadge({ score }: { score: number }) {
  const colour =
    score >= 90
      ? "bg-[#E4F1EB] text-[#2F8F6B]"
      : score >= 75
      ? "bg-[#E9EFEA] text-[#435548]"
      : "bg-[#F4F5F7] text-[#4A4E57]";

  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${colour}`}>
      {score}% match
    </span>
  );
}

export function ComparableRentals({ comps }: ComparableRentalsProps) {
  if (comps.length === 0) return null;

  const sorted = [...comps].sort((a, b) => b.weight - a.weight).slice(0, MAX_CARDS);
  const topWeight = sorted[0].weight || 1;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sorted.map((comp, i) => {
        const matchPct = Math.round((comp.weight / topWeight) * 100);
        const date = fmtDate(comp.asOf);
        return (
          <Link
            key={`${comp.rawAddress}-${i}`}
            href={rentalHref(comp)}
            className="animate-fade-up block overflow-hidden rounded-xl border border-[#E7E9EE] bg-white transition-shadow duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470] focus-visible:ring-offset-2"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            {comp.imageUrl ? (
              <div className="relative h-40 w-full">
                <Image
                  src={comp.imageUrl}
                  alt={comp.rawAddress}
                  fill
                  sizes="(min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                  unoptimized={isOptimizerBlocked(comp.imageUrl)}
                />
              </div>
            ) : (
              <div className="flex h-40 w-full items-center justify-center bg-[#F4F5F7]" aria-hidden="true">
                <Home className="h-8 w-8 text-[#C9CDD3]" />
              </div>
            )}
            <div className="p-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug text-[#16181D]">
                    {comp.rawAddress}
                  </p>
                  <MatchBadge score={matchPct} />
                </div>

                <p className="mt-2 text-xl font-semibold text-[#2E5470] tabular-nums">
                  {fmtRent(comp.weeklyRent)}
                </p>

                {date && <p className="mt-0.5 text-xs text-[#6B7077]">{date}</p>}

                {(comp.bedrooms != null || comp.bathrooms != null || comp.carSpaces != null || comp.landAreaSqm != null) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {comp.bedrooms != null && (
                      <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                        {comp.bedrooms} bed
                      </span>
                    )}
                    {comp.bathrooms != null && (
                      <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                        {comp.bathrooms} bath
                      </span>
                    )}
                    {comp.carSpaces != null && (
                      <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                        {comp.carSpaces} car
                      </span>
                    )}
                    {comp.landAreaSqm != null && (
                      <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                        {formatLandArea(comp.landAreaSqm)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
