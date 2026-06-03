import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "gold" | "data" | "up" | "down" | "warn";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** Show a leading status dot. */
  dot?: boolean;
};

const TONES: Record<BadgeTone, { wrap: string; dot: string }> = {
  neutral: { wrap: "bg-[#F4F5F7] text-[#4A4E57]", dot: "bg-[#8A8F97]" },
  gold: { wrap: "bg-[#EFE3CC] text-[#8A6830]", dot: "bg-[#C8A96E]" },
  data: { wrap: "bg-[#E4EBF1] text-[#335C7D]", dot: "bg-[#335C7D]" },
  up: { wrap: "bg-[#E4F1EB] text-[#2F8F6B]", dot: "bg-[#2F8F6B]" },
  down: { wrap: "bg-[#F7E7E5] text-[#C5544A]", dot: "bg-[#C5544A]" },
  warn: { wrap: "bg-[#F5EEDD] text-[#B8954A]", dot: "bg-[#B8954A]" },
};

/** Compact pill for status / labels. Use tokens, never raw rainbow fills. */
export function Badge({
  className,
  tone = "neutral",
  dot = false,
  children,
  ...props
}: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        t.wrap,
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}
