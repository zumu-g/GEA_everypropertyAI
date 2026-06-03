import { cn } from "@/lib/cn";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Add a subtle shadow lift on hover (default: hairline only, no shadow). */
  hover?: boolean;
  /** Padding preset. */
  padding?: "none" | "sm" | "md" | "lg";
};

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
} as const;

/**
 * Hairline-delineated surface — the data-site default.
 * Prefer this over shadow-heavy cards. See DESIGN.md.
 */
export function Card({
  className,
  hover = false,
  padding = "md",
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[#E7E9EE] bg-white",
        PADDING[padding],
        hover && "transition-shadow duration-200 hover:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
