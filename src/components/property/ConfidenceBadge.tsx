"use client";

import { clsx } from "clsx";
import type { ConfidenceLevel } from "@/types/property";

interface ConfidenceBadgeProps {
  /**
   * Numeric score 0–100. Used to derive level when `level` is not provided.
   */
  score: number;
  /**
   * Explicit confidence level from the type system.
   * When provided, takes precedence over the numeric score for colour selection.
   */
  level?: ConfidenceLevel;
  /** Show the text label alongside the percentage. Defaults to true. */
  showLabel?: boolean;
  size?: "sm" | "md";
}

// ── Colour + label config ────────────────────────────────────────────────────

const levelConfig: Record<
  ConfidenceLevel,
  { dot: string; badge: string; label: string }
> = {
  "very-high": {
    dot: "bg-[#C8A96E]",
    badge: "border-[#EFE3CC] bg-[#FBFBFC] text-[#8A6830]",
    label: "Very High",
  },
  high: {
    dot: "bg-[#C8A96E]",
    badge: "border-[#EFE3CC] bg-[#FBFBFC] text-[#8A6830]",
    label: "High",
  },
  medium: {
    dot: "bg-[#B8954A]",
    badge: "border-[#F5EEDD] bg-[#F5EEDD] text-[#B8954A]",
    label: "Medium",
  },
  low: {
    dot: "bg-[#C5544A]",
    badge: "border-[#F7E7E5] bg-[#F7E7E5] text-[#C5544A]",
    label: "Low",
  },
  "very-low": {
    dot: "bg-[#C5544A]",
    badge: "border-[#F7E7E5] bg-[#F7E7E5] text-[#C5544A]",
    label: "Very Low",
  },
};

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 85) return "very-high";
  if (score >= 65) return "high";
  if (score >= 45) return "medium";
  if (score >= 25) return "low";
  return "very-low";
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Pill-shaped confidence badge with a dot indicator and percentage score.
 * Colours are drawn from GEA brand tokens — gold for high confidence,
 * cool amber for medium, rose for low/very-low.
 */
export function ConfidenceBadge({
  score,
  level,
  showLabel = true,
  size = "sm",
}: ConfidenceBadgeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const resolvedLevel: ConfidenceLevel = level ?? scoreToLevel(clamped);
  const { dot, badge, label } = levelConfig[resolvedLevel];

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border font-medium tabular-nums",
        badge,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      )}
      title={`Confidence: ${clamped}% — ${label}`}
    >
      {/* Dot indicator */}
      <span
        className={clsx(
          "shrink-0 rounded-full",
          dot,
          size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2"
        )}
        aria-hidden="true"
      />

      {/* Score */}
      <span>{clamped}%</span>

      {/* Label (hidden on smallest screens via sr-only, visible md+) */}
      {showLabel && (
        <span className="sr-only sm:not-sr-only">{label}</span>
      )}
    </span>
  );
}
