"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { PropertyProfile } from "@/types/property";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── SVG Icon Primitives ──────────────────────────────────────────────────────
// Inline SVGs avoid a lucide-react dependency mismatch for custom silhouettes.

function BedIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 20V10a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10" />
      <path d="M2 14h20" />
      <path d="M7 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M12 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function BathIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 6a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v5H9V6Z" />
      <path d="M3 13h18v1a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-1Z" />
      <path d="M5 18v2" />
      <path d="M19 18v2" />
    </svg>
  );
}

function CarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 17H3v-5l2-5h14l2 5v5h-2" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
      <path d="M5 12h14" />
    </svg>
  );
}

function LandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18" />
    </svg>
  );
}

function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22V8h6v14" />
      <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M16 10h.01" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// ── Attribute Strip ───────────────────────────────────────────────────────────
// Small horizontal row: beds / baths / car spaces / land size

interface AttrItem {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
}

function AttributeStrip({ attrs }: { attrs: AttrItem[] }) {
  if (attrs.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {attrs.map(({ icon: Icon, value, label }, i) => (
        <div key={label} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="mr-2 h-3 w-px bg-[#E7E9EE]" aria-hidden="true" />
          )}
          <Icon className="h-4 w-4 text-[#6B7077]" />
          <span
            className="text-sm font-medium text-[#16181D] tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {value}
          </span>
          <span className="text-xs text-[#6B7077]">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  iconComponent: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  confidence?: number;
  delay?: number;
  reduced?: boolean;
}

function StatCard({
  iconComponent: Icon,
  label,
  value,
  sub,
  confidence,
  delay = 0,
  reduced = false,
}: StatCardProps) {
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="group rounded-xl border border-[#E7E9EE] bg-[#FBFBFC] p-5 transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F4F5F7]">
            <Icon className="h-4 w-4 text-[#C8A96E]" />
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-[#6B7077]">
            {label}
          </span>
        </div>
        {confidence != null && (
          <ConfidenceBadge score={confidence} size="sm" />
        )}
      </div>

      <p
        className="mt-3 text-2xl font-semibold text-[#16181D] tabular-nums"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {value}
      </p>

      {sub && (
        <p className="mt-1 text-xs text-[#6B7077]">{sub}</p>
      )}
    </motion.div>
  );
}

// ── KeyStats ─────────────────────────────────────────────────────────────────

interface KeyStatsProps {
  property: PropertyProfile;
}

export function KeyStats({ property }: KeyStatsProps) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const { physicalAttributes, valuation, currentListing, saleHistory } =
    property;
  const lastSale = saleHistory[0];

  // ── Attribute strip: bed / bath / car / land ─────────────────────────────
  const attrItems: AttrItem[] = [];
  if (physicalAttributes.bedrooms != null) {
    attrItems.push({
      icon: BedIcon,
      value: physicalAttributes.bedrooms,
      label: physicalAttributes.bedrooms === 1 ? "bed" : "beds",
    });
  }
  if (physicalAttributes.bathrooms != null) {
    attrItems.push({
      icon: BathIcon,
      value: physicalAttributes.bathrooms,
      label: physicalAttributes.bathrooms === 1 ? "bath" : "baths",
    });
  }
  if (physicalAttributes.carSpaces != null) {
    attrItems.push({
      icon: CarIcon,
      value: physicalAttributes.carSpaces,
      label: physicalAttributes.carSpaces === 1 ? "car" : "cars",
    });
  }
  if (physicalAttributes.landAreaSqm != null) {
    attrItems.push({
      icon: LandIcon,
      value: `${physicalAttributes.landAreaSqm.toLocaleString("en-AU")} m²`,
      label: "land",
    });
  }

  // ── Financial stat cards ─────────────────────────────────────────────────
  type CardDef = {
    key: string;
    iconComponent: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    sub?: string;
    confidence?: number;
  };

  const cards: CardDef[] = [];

  if (valuation) {
    cards.push({
      key: "valuation",
      iconComponent: TrendingUpIcon,
      label: "Estimated Value",
      value: formatCurrency(valuation.estimatedValue.amount),
      sub: `${formatCurrency(valuation.lowRange.amount)} – ${formatCurrency(
        valuation.highRange.amount
      )}`,
      confidence: valuation.confidence.score * 100,
    });
  }

  if (lastSale) {
    cards.push({
      key: "lastSale",
      iconComponent: DollarIcon,
      label: "Last Sale",
      value: lastSale.isConfidential
        ? "Confidential"
        : formatCurrency(lastSale.price.amount),
      sub: formatDate(lastSale.saleDate),
    });
  }

  if (physicalAttributes.yearBuilt) {
    cards.push({
      key: "yearBuilt",
      iconComponent: BuildingIcon,
      label: "Year Built",
      value: String(physicalAttributes.yearBuilt),
    });
  }

  if (currentListing) {
    cards.push({
      key: "dom",
      iconComponent: ClockIcon,
      label: "Days on Market",
      value: String(currentListing.daysOnMarket),
      sub: currentListing.priceText ?? undefined,
    });
  }

  if (attrItems.length === 0 && cards.length === 0) return null;

  return (
    <section>
      <h2
        className="mb-5 text-xl text-[#16181D]"
      >
        Key Statistics
      </h2>

      {/* Attribute strip */}
      {attrItems.length > 0 && (
        <div className="mb-6 rounded-xl border border-[#E7E9EE] bg-[#F4F5F7] px-5 py-4">
          <AttributeStrip attrs={attrItems} />
        </div>
      )}

      {/* Financial stat cards */}
      {cards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, i) => (
            <StatCard
              key={card.key}
              iconComponent={card.iconComponent}
              label={card.label}
              value={card.value}
              sub={card.sub}
              confidence={card.confidence}
              delay={i * 0.06}
              reduced={reduced}
            />
          ))}
        </div>
      )}
    </section>
  );
}
