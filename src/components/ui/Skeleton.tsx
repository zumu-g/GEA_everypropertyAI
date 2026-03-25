"use client";

import { clsx } from "clsx";

interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  className,
  rounded = "md",
}: SkeletonProps) {
  return (
    <div
      className={clsx(
        "animate-pulse bg-gray-200",
        {
          "rounded-sm": rounded === "sm",
          "rounded-md": rounded === "md",
          "rounded-lg": rounded === "lg",
          "rounded-xl": rounded === "xl",
          "rounded-full": rounded === "full",
        },
        className
      )}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
