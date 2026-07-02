"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Database } from "lucide-react";

export interface ComparableResult {
  address: string;
  suburb: string;
  price: number;
  saleDate: string;
  beds?: number;
  baths?: number;
  landAreaSqm?: number;
  similarityScore: number;
}

export interface ComparableSalesProps {
  suburb: string;
  beds?: number;
  baths?: number;
  propertyType?: string;
  excludeSlug?: string;
}

const FMT = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function fmtPrice(n: number): string {
  return FMT.format(n);
}

function fmtDate(iso: string): string {
  if (!iso) return "";
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

function SimilarityBadge({ score }: { score: number }) {
  const colour =
    score >= 130
      ? "bg-[#E4F1EB] text-[#2F8F6B]"
      : score >= 110
      ? "bg-[#E9EFEA] text-[#435548]"
      : "bg-[#F4F5F7] text-[#4A4E57]";

  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${colour}`}>
      {score}% match
    </span>
  );
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-[#E7E9EE] bg-white p-5 ">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="h-4 w-2/3 rounded bg-[#EDEFF2]" />
        <div className="h-5 w-16 rounded-full bg-[#EDEFF2]" />
      </div>
      <div className="mb-1.5 h-6 w-1/2 rounded bg-[#EDEFF2]" />
      <div className="mb-3 h-3 w-1/3 rounded bg-[#EDEFF2]" />
      <div className="flex gap-2">
        <div className="h-5 w-12 rounded-full bg-[#EDEFF2]" />
        <div className="h-5 w-12 rounded-full bg-[#EDEFF2]" />
      </div>
    </div>
  );
}

export function ComparableSales({
  suburb,
  beds,
  baths,
  propertyType,
  excludeSlug,
}: ComparableSalesProps) {
  const [comparables, setComparables] = useState<ComparableResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!suburb) {
      setLoading(false);
      setFetched(true);
      return;
    }

    const params = new URLSearchParams({ suburb });
    if (beds != null)        params.set("beds",         String(beds));
    if (baths != null)       params.set("baths",        String(baths));
    if (propertyType)        params.set("propertyType", propertyType);
    if (excludeSlug)         params.set("excludeSlug",  excludeSlug);

    setLoading(true);
    fetch(`/api/comparable-sales?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { comparables: [] }))
      .then((data: { comparables?: ComparableResult[] } | ComparableResult[]) => {
        const list = Array.isArray(data)
          ? (data as ComparableResult[])
          : ((data as { comparables?: ComparableResult[] }).comparables ?? []);
        setComparables(list.slice(0, 4));
      })
      .catch(() => {
        setComparables([]);
      })
      .finally(() => {
        setLoading(false);
        setFetched(true);
      });
  }, [suburb, beds, baths, propertyType, excludeSlug]);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (fetched && comparables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[#E7E9EE] bg-white px-6 py-12 text-center ">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F4F5F7]">
          <Database className="h-7 w-7 text-[#2E5470] opacity-60" aria-hidden="true" />
        </div>
        <p className="text-base font-medium text-[#33363D]">
          Not enough local data yet
        </p>
        <p className="mt-1 text-sm text-[#6B7077]">
          Check back after more properties in {suburb} have been searched.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {comparables.map((comp, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.07 }}
          className="rounded-xl border border-[#E7E9EE] bg-white p-5 transition-shadow duration-200 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-snug text-[#16181D]">
              {comp.address}
            </p>
            <SimilarityBadge score={comp.similarityScore} />
          </div>

          <p
            className="mt-2 text-xl font-bold text-[#2E5470] tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {fmtPrice(comp.price)}
          </p>

          {comp.saleDate && (
            <p className="mt-0.5 text-xs text-[#6B7077]">{fmtDate(comp.saleDate)}</p>
          )}

          {(comp.beds != null || comp.baths != null || comp.landAreaSqm != null) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {comp.beds != null && (
                <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                  {comp.beds} bed
                </span>
              )}
              {comp.baths != null && (
                <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                  {comp.baths} bath
                </span>
              )}
              {comp.landAreaSqm != null && (
                <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#4A4E57]">
                  {comp.landAreaSqm.toLocaleString("en-AU")}m²
                </span>
              )}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
