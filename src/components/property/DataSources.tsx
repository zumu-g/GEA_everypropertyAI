"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink, Clock } from "lucide-react";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { DataSource, ConfidenceScore } from "@/types/property";

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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DataSources({
  sources,
  overallConfidence,
  fieldProvenance,
}: DataSourcesProps) {
  const [isOpen, setIsOpen] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Count how many fields each source contributed to
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
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-white px-6 py-4 shadow-sm transition-shadow duration-200 hover:shadow-md"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Data Sources</h2>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {sources.length} sources
          </span>
          <ConfidenceBadge score={overallConfidence.score * 100} />
        </div>
        <ChevronDown
          className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2">
              {entries.map((entry, i) => (
                <motion.div
                  key={entry.source.name}
                  initial={
                    prefersReducedMotion ? false : { opacity: 0, y: 8 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: i * 0.05 }}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-5 py-3 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {entry.source.name}
                      </span>
                      {entry.source.url && (
                        <a
                          href={entry.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 transition-colors duration-150 hover:text-brand-600"
                          aria-label={`Visit ${entry.source.name}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        Crawled {timeAgo(entry.source.crawledAt)}
                      </span>
                      <span>
                        {entry.fieldsCount} field
                        {entry.fieldsCount !== 1 ? "s" : ""} extracted
                      </span>
                    </div>
                  </div>
                  <ConfidenceBadge score={entry.confidence.score * 100} />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
