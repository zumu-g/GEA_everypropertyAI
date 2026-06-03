"use client";

import { clsx } from "clsx";

// ── Base Skeleton ────────────────────────────────────────────────────────────

interface SkeletonProps {
  /** Explicit width override (e.g. "6rem"). Defaults to 100% unless a variant is used. */
  width?: string;
  /** Explicit height override. Defaults to 1rem unless a variant is used. */
  height?: string;
  className?: string;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
  /** Preset layout variant — overrides width/height defaults. */
  variant?: "text" | "card" | "hero" | "stat";
}

/**
 * Brand-aligned skeleton placeholder.
 * Uses the GEA surface colour (#F4F5F7) with an animated shimmer.
 * Never use `bg-gray-200` — that violates the GEA colour contract.
 */
export function Skeleton({
  width,
  height,
  className,
  rounded = "md",
  variant,
}: SkeletonProps) {
  const variantStyles: Record<string, string> = {
    text: "h-4 w-full",
    card: "h-40 w-full rounded-xl",
    hero: "h-64 w-full rounded-xl sm:h-80",
    stat: "h-24 w-full rounded-xl",
  };

  const roundedStyles = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    full: "rounded-full",
  };

  const inlineStyle: React.CSSProperties = {};
  if (width) inlineStyle.width = width;
  if (height) inlineStyle.height = height;

  return (
    <div
      className={clsx(
        // Base shimmer using GEA surface tokens
        "relative overflow-hidden bg-[#F4F5F7]",
        // Shimmer pseudo-element via animate-shimmer (defined in globals.css)
        "before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer",
        "before:bg-gradient-to-r before:from-transparent before:via-[#FBFBFC]/70 before:to-transparent",
        // Variant preset or rounded class
        variant ? variantStyles[variant] : roundedStyles[rounded],
        className
      )}
      style={Object.keys(inlineStyle).length > 0 ? inlineStyle : undefined}
      aria-hidden="true"
      role="presentation"
    />
  );
}

// ── Compound Skeleton Layouts ────────────────────────────────────────────────

/** Skeleton for a text block — stacked lines of varying widths. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ["w-full", "w-5/6", "w-4/6", "w-3/4", "w-full", "w-2/3"];
  return (
    <div className={clsx("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className={widths[i % widths.length]}
        />
      ))}
    </div>
  );
}

/** Skeleton for a key-stat card (icon + label + value). */
export function SkeletonStatCard({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-[#E7E9EE] bg-[#FBFBFC] p-6",
        className
      )}
      aria-hidden="true"
    >
      <div className="flex items-center gap-2">
        <Skeleton width="2.25rem" height="2.25rem" rounded="lg" />
        <Skeleton variant="text" className="w-24" />
      </div>
      <Skeleton variant="text" className="mt-4 w-32 h-7" />
      <Skeleton variant="text" className="mt-2 w-20" />
    </div>
  );
}

/** Skeleton for a full property hero section. */
export function SkeletonHero({ className }: { className?: string }) {
  return (
    <div className={clsx("space-y-4", className)} aria-hidden="true">
      <Skeleton variant="hero" />
      <Skeleton variant="text" className="w-2/3 h-6" />
      <Skeleton variant="text" className="w-1/2" />
      <div className="flex gap-3 pt-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width="4rem" height="1.5rem" rounded="full" />
        ))}
      </div>
    </div>
  );
}
