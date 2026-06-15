"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, Home, ChevronUp, ChevronDown, ChevronsUpDown, Printer, Download, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";

// ── Row shape (mirrors StreetRow from /api/street-details) ───────────────────
interface StreetRow {
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  slug: string;
  propertyHref: string;
  landAreaSqm: number | null;
  buildingAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garage: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  lastListedDate: string | null;
  listedPrice: number | null;
}

// ── Formatting helpers (match KeyStats.tsx conventions) ──────────────────────
const CURRENCY = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function fmtCurrency(n: number | null): string {
  return n == null ? "—" : CURRENCY.format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtArea(n: number | null): string {
  return n == null ? "—" : `${n.toLocaleString()} m²`;
}

function fmtNum(n: number | null): string {
  return n == null ? "—" : String(n);
}

const DETAIL_KEYS: (keyof StreetRow)[] = [
  "landAreaSqm",
  "buildingAreaSqm",
  "bedrooms",
  "bathrooms",
  "garage",
  "lastSaleDate",
  "lastSalePrice",
  "lastListedDate",
  "listedPrice",
];

/** True if a row already has at least one detail field populated. */
function rowHasData(row: StreetRow): boolean {
  return DETAIL_KEYS.some((k) => row[k] != null);
}

/** Recover the StructuredAddress object encoded in a propertyHref. */
function addressFromHref(href: string): Record<string, unknown> {
  try {
    const encoded = href.split("address=")[1] ?? "";
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    return {};
  }
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Merge a crawled profile's `data` object into a street row (same mapping as the API). */
function mergeProfileIntoRow(row: StreetRow, data: Record<string, unknown>): StreetRow {
  const saleHistory = Array.isArray(data.saleHistory)
    ? (data.saleHistory as Array<Record<string, unknown>>)
    : [];
  const sale = saleHistory[0] ?? {};
  const listing = (data.currentListing ?? {}) as Record<string, unknown>;
  const listingHistory = Array.isArray(data.listingHistory)
    ? (data.listingHistory as Array<Record<string, unknown>>)
    : [];

  return {
    ...row,
    landAreaSqm: row.landAreaSqm ?? asNum(data.landAreaSqm) ?? asNum(data.landArea),
    buildingAreaSqm:
      row.buildingAreaSqm ?? asNum(data.buildingAreaSqm) ?? asNum(data.buildingArea),
    bedrooms: row.bedrooms ?? asNum(data.bedrooms),
    bathrooms: row.bathrooms ?? asNum(data.bathrooms),
    garage: row.garage ?? asNum(data.garages) ?? asNum(data.carSpaces),
    lastSaleDate: row.lastSaleDate ?? asStr(sale.date) ?? asStr(sale.saleDate),
    lastSalePrice: row.lastSalePrice ?? asNum(sale.price),
    lastListedDate:
      row.lastListedDate ??
      asStr(listing.dateFirstListed) ??
      asStr(listingHistory[0]?.dateFirstListed),
    listedPrice:
      row.listedPrice ?? asNum(data.currentPrice) ?? asNum(data.priceNumeric) ?? asNum(listing.price),
  };
}

// ── Sortable columns ─────────────────────────────────────────────────────────
type SortKey =
  | "streetAddress"
  | "landAreaSqm"
  | "buildingAreaSqm"
  | "bedrooms"
  | "bathrooms"
  | "garage"
  | "lastSaleDate"
  | "lastSalePrice"
  | "listedPrice"
  | "lastListedDate";

interface ColumnDef {
  key: SortKey;
  label: string;
  type: "text" | "number" | "date";
  align: "left" | "right" | "center";
}

const COLUMNS: ColumnDef[] = [
  { key: "streetAddress", label: "Address", type: "text", align: "left" },
  { key: "landAreaSqm", label: "Land", type: "number", align: "right" },
  { key: "buildingAreaSqm", label: "House", type: "number", align: "right" },
  { key: "bedrooms", label: "Bed", type: "number", align: "center" },
  { key: "bathrooms", label: "Bath", type: "number", align: "center" },
  { key: "garage", label: "Garage", type: "number", align: "center" },
  { key: "lastSaleDate", label: "Last Sale", type: "date", align: "right" },
  { key: "lastSalePrice", label: "Sale $", type: "number", align: "right" },
  { key: "listedPrice", label: "Listed $", type: "number", align: "right" },
  { key: "lastListedDate", label: "Last Listed", type: "date", align: "right" },
];

function cellValue(row: StreetRow, col: ColumnDef): string {
  switch (col.type) {
    case "date":
      return fmtDate(row[col.key] as string | null);
    case "number":
      if (col.key === "lastSalePrice" || col.key === "listedPrice") {
        return fmtCurrency(row[col.key] as number | null);
      }
      if (col.key === "landAreaSqm" || col.key === "buildingAreaSqm") {
        return fmtArea(row[col.key] as number | null);
      }
      return fmtNum(row[col.key] as number | null);
    default:
      return row.streetAddress;
  }
}

function StreetResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";

  const [rows, setRows] = useState<StreetRow[]>([]);
  const [streetLabel, setStreetLabel] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("streetAddress");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Crawl-on-demand state
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState({ done: 0, total: 0 });
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!query) return;
    setIsLoading(true);
    setIsFallback(false);

    fetch(`/api/street-details?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((data) => {
        setRows(data.rows ?? []);
        setStreetLabel(data.streetLabel ?? query);
        setLocationLabel(data.locationLabel ?? "");
        setIsFallback(Boolean(data.fallback));
      })
      .catch(() => {
        setRows([]);
        setIsFallback(true);
      })
      .finally(() => setIsLoading(false));
  }, [query]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "streetAddress" ? "asc" : "desc");
    }
  }

  const sortedRows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey)!;
    const dir = sortDir === "asc" ? 1 : -1;

    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];

      // Nulls always sink to the bottom, regardless of direction
      const aNull = av == null || av === "";
      const bNull = bv == null || bv === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;

      let cmp: number;
      if (col.type === "number") {
        cmp = (av as number) - (bv as number);
      } else if (col.type === "date") {
        cmp = new Date(av as string).getTime() - new Date(bv as string).getTime();
      } else {
        // Address: sort by leading street number, then text
        const na = parseInt(String(av).match(/^\d+/)?.[0] ?? "0", 10);
        const nb = parseInt(String(bv).match(/^\d+/)?.[0] ?? "0", 10);
        cmp = na - nb || String(av).localeCompare(String(bv));
      }
      return cmp * dir;
    });
  }, [rows, sortKey, sortDir]);

  const MAX_CRAWL = 12; // cap properties crawled per click (cost/time guard)
  const CONCURRENCY = 3;

  const emptyRowCount = rows.filter((r) => !rowHasData(r)).length;

  async function loadDetails() {
    if (isCrawling) return;
    const targets = rows.filter((r) => !rowHasData(r)).slice(0, MAX_CRAWL);
    if (targets.length === 0) return;

    setIsCrawling(true);
    setCrawlProgress({ done: 0, total: targets.length });
    setPendingSlugs(new Set(targets.map((t) => t.slug)));

    let done = 0;
    const queue = [...targets];

    async function worker() {
      while (queue.length > 0) {
        const row = queue.shift();
        if (!row) break;
        try {
          const address = addressFromHref(row.propertyHref);
          const res = await fetch("/api/property", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address }),
          });
          if (res.ok) {
            const json = await res.json();
            const merged = mergeProfileIntoRow(row, json.profile?.data ?? {});
            setRows((prev) => prev.map((r) => (r.slug === row.slug ? merged : r)));
          }
        } catch {
          /* ignore individual failures — row stays "—" */
        } finally {
          done += 1;
          setCrawlProgress({ done, total: targets.length });
          setPendingSlugs((prev) => {
            const next = new Set(prev);
            next.delete(row.slug);
            return next;
          });
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setIsCrawling(false);
  }

  const printedOn = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6B7077] transition-colors duration-150 hover:text-[#C8A96E] print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Search
      </Link>

      {/* Print-only report masthead */}
      <div className="hidden print:mb-6 print:block print:border-b print:border-[#16181D] print:pb-4">
        <div className="flex items-baseline justify-between">
          <span
            className="text-xl tracking-tight text-[#16181D]"
          >
            Property<span className="text-[#C8A96E]">IQ</span>
            <span className="ml-2 text-xs uppercase tracking-wide text-[#6B7077]">
              by Grants Estate Agents
            </span>
          </span>
          <span className="text-xs text-[#6B7077]">Generated {printedOn}</span>
        </div>
      </div>

      <div className="mt-8 mb-6 flex items-start justify-between gap-4 print:mt-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-5 w-5 text-[#C8A96E] print:hidden" />
            <h1
              className="text-3xl font-semibold tracking-tight text-[#16181D] print:text-2xl"
            >
              {streetLabel || query}
            </h1>
          </div>
          {locationLabel && (
            <p className="ml-7 text-sm text-[#6B7077] print:ml-0">{locationLabel}</p>
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 print:hidden">
            {emptyRowCount > 0 && (
              <button
                type="button"
                onClick={loadDetails}
                disabled={isCrawling}
                className="inline-flex items-center gap-2 rounded-lg bg-[#C8A96E] px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-[#B8954A] focus:outline-none focus:ring-2 focus:ring-[#C8A96E] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isCrawling ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading {crawlProgress.done}/{crawlProgress.total}…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Load details
                    {emptyRowCount > MAX_CRAWL ? ` (${MAX_CRAWL})` : ""}
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#E7E9EE] bg-white px-4 py-2.5 text-sm font-medium text-[#16181D] transition-all duration-150 hover:border-[#C8A96E] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#C8A96E] focus:ring-offset-2"
            >
              <Printer className="h-4 w-4 text-[#C8A96E]" />
              Print report
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height="3rem" rounded="lg" />
          ))}
        </div>
      ) : isFallback || rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[#E7E9EE] bg-white px-6 py-16 text-center ">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F4F5F7]">
            <Home className="h-7 w-7 text-[#C8A96E] opacity-70" />
          </div>
          <p className="text-base font-medium text-[#33363D]">
            No addresses found for this street
          </p>
          <p className="mt-1 text-sm text-[#6B7077]">
            Try searching with a full address including suburb and state.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#C8A96E] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#B8954A]"
          >
            Search an address
          </Link>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <p className="mb-4 text-sm text-[#6B7077]">
            {rows.length} propert{rows.length === 1 ? "y" : "ies"} found
            <span className="print:hidden"> · click a column to sort</span>
          </p>

          <div className="overflow-x-auto rounded-xl border border-[#E7E9EE] bg-white print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
            <table className="w-full min-w-[840px] border-collapse text-sm print:min-w-0 print:text-xs">
              <thead>
                <tr className="border-b border-[#E7E9EE] bg-[#FBFBFC]">
                  {COLUMNS.map((col) => {
                    const active = col.key === sortKey;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        className={`whitespace-nowrap px-4 py-3 font-medium text-[#4A4E57] ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        } ${
                          // Pin the address column so it stays visible while the
                          // comparison columns scroll horizontally on mobile.
                          col.key === "streetAddress"
                            ? "sticky left-0 z-20 bg-[#FBFBFC] border-r border-[#E7E9EE] print:static print:border-r-0"
                            : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={`inline-flex items-center gap-1 transition-colors duration-150 hover:text-[#C8A96E] focus:outline-none ${
                            active ? "text-[#16181D]" : ""
                          } ${
                            col.align === "right"
                              ? "flex-row-reverse"
                              : col.align === "center"
                              ? "justify-center"
                              : ""
                          }`}
                          aria-label={`Sort by ${col.label}`}
                        >
                          {col.label}
                          {active ? (
                            sortDir === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5 text-[#C8A96E] print:hidden" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-[#C8A96E] print:hidden" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 opacity-40 print:hidden" />
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr
                    key={row.slug}
                    className={`border-b border-[#E7E9EE] last:border-0 transition-colors duration-100 hover:bg-[#FBFBFC] ${
                      i % 2 === 0 ? "bg-white" : "bg-[#FBFBFC]"
                    }`}
                  >
                    {COLUMNS.map((col) => {
                      const value = cellValue(row, col);
                      const muted = value === "—";
                      const alignClass =
                        col.align === "right"
                          ? "text-right"
                          : col.align === "center"
                          ? "text-center"
                          : "text-left";

                      if (col.key === "streetAddress") {
                        return (
                          <td
                            key={col.key}
                            className={`px-4 py-3 ${alignClass} sticky left-0 z-10 border-r border-[#E7E9EE] print:static print:border-r-0 ${
                              // Carry the row's stripe colour so the pinned cell isn't
                              // transparent over the scrolling columns behind it.
                              i % 2 === 0 ? "bg-white" : "bg-[#FBFBFC]"
                            }`}
                          >
                            <span className="inline-flex items-center gap-2">
                              <Link
                                href={row.propertyHref}
                                className="font-medium text-[#16181D] transition-colors duration-150 hover:text-[#C8A96E] hover:underline"
                              >
                                {row.streetAddress}
                              </Link>
                              {pendingSlugs.has(row.slug) && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#C8A96E] print:hidden" />
                              )}
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={col.key}
                          className={`whitespace-nowrap px-4 py-3 tabular-nums ${alignClass} ${
                            muted ? "text-[#6B7077]" : "text-[#16181D]"
                          }`}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default function StreetPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-6 py-10 space-y-3">
          <Skeleton height="1.5rem" rounded="lg" />
          <Skeleton height="3rem" rounded="lg" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height="3rem" rounded="lg" />
          ))}
        </div>
      }
    >
      <StreetResults />
    </Suspense>
  );
}
