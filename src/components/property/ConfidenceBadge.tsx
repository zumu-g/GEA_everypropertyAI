"use client";

import { Shield } from "lucide-react";
import { clsx } from "clsx";

interface ConfidenceBadgeProps {
  score: number;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function ConfidenceBadge({
  score,
  showLabel = true,
  size = "sm",
}: ConfidenceBadgeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  const variant =
    clamped >= 80 ? "green" : clamped >= 50 ? "yellow" : "red";

  const colors = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    yellow: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };

  const labels = {
    green: "High",
    yellow: "Medium",
    red: "Low",
  };

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        colors[variant],
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      )}
    >
      <Shield
        className={size === "sm" ? "h-3 w-3" : "h-4 w-4"}
        aria-hidden="true"
      />
      {clamped}%
      {showLabel && (
        <span className="sr-only sm:not-sr-only"> {labels[variant]}</span>
      )}
    </span>
  );
}
