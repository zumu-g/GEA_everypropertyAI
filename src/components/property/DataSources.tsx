"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink, Clock } from "lucide-react";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { DataSource, ConfidenceScore } from "@/types/property";

// ── Types ────────────────────────────────────────────────────────────────────

interface DataSourceEntry {
  source: DataSource;
  fieldsCount: number;
  confidence: ConfidenceScore;
}

interface DataSourcesProps {
  sources: DataSource[];
  overallConfidence: ConfidenceScore;
  fieldProvenance: Record<string, { sources: DataSource[] } | undefined>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ score }: { score: number }) {
  // score is 0–1
  const pct = Math.max(0, Math.min(1, score)) * 100;
  const colour =
    pct >= 65
      ? "bg-[#C8A96E]"
      : pct >= 45
      ? "bg-[#B8954A]"
      : "bg-[#C5544A]";

  return (
    <div
      className="h-1 w-16 overflow-hidden rounded-full bg-[#E7E9EE]"
      title={`${Math.round(pct)}% confidence`}
      aria-label={`${Math.round(pct)}% confidence`}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${colour}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Source row ────────────────────────────────────────────────────────────────

function SourceRow({
  entry,
  delay,
  reduced,
}: {
  entry: DataSourceEntry;
  delay: number;
  reduced: boolean;
}) {
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay }}
      className="flex items-center justify-between gap-4 rounded-lg border border-[#E7E9EE] bg-[#FBFBFC] px-5 py-3.5"
    >
      {/* Source name + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {entry.source.url ? (
            <a
              href={entry.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#16181D] transition-colors duration-150 hover:text-[#C8A96E] focus:outline-none focus:underline"
              aria-label={`Visit ${entry.source.name}`}
            >
              {entry.source.name}
            </a>
          ) : (
            <span className="font-medium text-[#16181D]">
              {entry.source.name}
            </span>
          )}
          {entry.source.url && (
            <ExternalLink
              className="h-3 w-3 shrink-0 text-[#6B7077]"
              aria-hidden="true"
            />
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B7077]">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Crawled {timeAgo(entry.source.crawledAt)}
          </span>
          {entry.fieldsCount > 0 && (
            <span>
              {entry.fieldsCount} field{entry.fieldsCount !== 1 ? "s" : ""} extracted
            </span>
          )}
        </div>
      </div>

      {/* Confidence indicators */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <ConfidenceBadge
          score={entry.confidence.score * 100}
          level={entry.confidence.level}
          size="sm"
          showLabel={false}
        />
        <ConfidenceBar score={entry.confidence.score} />
      </div>
    </motion.div>
  );
}

// ── DataSources ───────────────────────────────────────────────────────────────

export function DataSources({
  sources,
  overallConfidence,
  fieldProvenance,
}: DataSourcesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Count how many fields each source contributed
  const sourceFieldCounts = new Map<string, number>();
  for (const fp of Object.values(fieldProvenance)) {
    if (!fp?.sources) continue;
    for (const src of fp.sources) {
      sourceFieldCounts.set(
        src.name,
        (sourceFieldCounts.get(src.name) ?? 0) + 1
      );
    }
  }

  const entries: DataSourceEntry[] = sources.map((src) => ({
    source: src,
    fieldsCount: sourceFieldCounts.get(src.name) ?? 0,
    confidence: {
      ...overallConfidence,
      score: Math.min(
        1,
        overallConfidence.score + (sourceFieldCounts.get(src.name) ?? 0) * 0.02
      ),
    },
  }));

  return (
    <section>
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-xl border border-[#E7E9EE] bg-[#FBFBFC] px-6 py-4 transition-all duration-150 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#C8A96E] focus:ring-offset-2 active:scale-[0.99]"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <h2
            className="text-base text-[#16181D]"
          >
            Data Sources
          </h2>

          {/* Source count pill */}
          <span className="rounded-full border border-[#E7E9EE] bg-[#F4F5F7] px-2 py-0.5 text-xs font-medium text-[#6B7077]">
            {sources.length} {sources.length === 1 ? "source" : "sources"}
          </span>

          {/* Overall confidence */}
          <ConfidenceBadge
            score={overallConfidence.score * 100}
            level={overallConfidence.level}
            size="sm"
          />
        </div>

        <ChevronDown
          className={`h-4 w-4 text-[#6B7077] transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Expandable source list */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="sources-panel"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2">
              {entries.map((entry, i) => (
                <SourceRow
                  key={entry.source.name}
                  entry={entry}
                  delay={i * 0.04}
                  reduced={reduced}
                />
              ))}
            </div>

            {/* Attribution note */}
            <p className="mt-4 text-xs text-[#6B7077]">
              Data aggregated from {sources.length} independent portal
              {sources.length !== 1 ? "s" : ""}. Timestamps reflect when each
              source was last crawled.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
