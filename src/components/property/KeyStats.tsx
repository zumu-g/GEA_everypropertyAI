"use client";

import { motion } from "framer-motion";
import {
  TrendingUp,
  Calendar,
  Maximize,
  Building2,
  Clock,
  DollarSign,
} from "lucide-react";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { PropertyProfile } from "@/types/property";

interface KeyStatsProps {
  property: PropertyProfile;
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

export function KeyStats({ property }: KeyStatsProps) {
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const lastSale = property.saleHistory[0];
  const { physicalAttributes, valuation, currentListing } = property;

  const cards: {
    key: string;
    icon: typeof TrendingUp;
    label: string;
    value: string;
    sub?: string;
    confidence?: number;
  }[] = [];

  if (valuation) {
    cards.push({
      key: "valuation",
      icon: TrendingUp,
      label: "Estimated Value",
      value: formatCurrency(valuation.estimatedValue.amount),
      sub: `${formatCurrency(valuation.lowRange.amount)} - ${formatCurrency(valuation.highRange.amount)}`,
      confidence: valuation.confidence.score * 100,
    });
  }

  if (lastSale) {
    cards.push({
      key: "lastSale",
      icon: DollarSign,
      label: "Last Sale Price",
      value: lastSale.isConfidential
        ? "Confidential"
        : formatCurrency(lastSale.price.amount),
      sub: formatDate(lastSale.saleDate),
    });
  }

  if (physicalAttributes.landAreaSqm) {
    cards.push({
      key: "land",
      icon: Maximize,
      label: "Land Area",
      value: `${physicalAttributes.landAreaSqm.toLocaleString()} m\u00B2`,
      sub: physicalAttributes.buildingAreaSqm
        ? `Building: ${physicalAttributes.buildingAreaSqm.toLocaleString()} m\u00B2`
        : undefined,
    });
  }

  if (physicalAttributes.yearBuilt) {
    cards.push({
      key: "yearBuilt",
      icon: Building2,
      label: "Year Built",
      value: String(physicalAttributes.yearBuilt),
    });
  }

  if (currentListing) {
    cards.push({
      key: "dom",
      icon: Clock,
      label: "Days on Market",
      value: String(currentListing.daysOnMarket),
      sub: currentListing.priceText ?? undefined,
    });
  }

  if (cards.length === 0) return null;

  return (
    <section>
      <h2 className="mb-6 text-2xl font-bold text-gray-900">Key Statistics</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.key}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="group rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow duration-200 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50">
                    <Icon className="h-5 w-5 text-brand-600" aria-hidden="true" />
                  </div>
                  <span className="text-sm font-medium text-gray-500">
                    {card.label}
                  </span>
                </div>
                {card.confidence != null && (
                  <ConfidenceBadge score={card.confidence} />
                )}
              </div>
              <p className="mt-3 text-2xl font-bold text-gray-900">
                {card.value}
              </p>
              {card.sub && (
                <p className="mt-1 text-sm text-gray-500">{card.sub}</p>
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
