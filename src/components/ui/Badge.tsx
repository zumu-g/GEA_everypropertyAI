import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "accent" | "accent2" | "data" | "up" | "down" | "warn";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** Show a leading status dot. */
  dot?: boolean;
};

const TONES: Record<BadgeTone, { wrap: string; dot: string }> = {
  neutral: { wrap: "bg-[#F4F5F7] text-[#4A4E57]", dot: "bg-[#8A8F97]" },
  accent: { wrap: "bg-[#E4EBF1] text-[#24435A]", dot: "bg-[#2E5470]" },
  accent2: { wrap: "bg-[#E9EFEA] text-[#435548]", dot: "bg-[#5C7466]" },
  data: { wrap: "bg-[#E4EBF1] text-[#24435A]", dot: "bg-[#2E5470]" },
  up: { wrap: "bg-[#E4F1EB] text-[#2F8F6B]", dot: "bg-[#2F8F6B]" },
  down: { wrap: "bg-[#F7E7E5] text-[#C5544A]", dot: "bg-[#C5544A]" },
  warn: { wrap: "bg-[#F5EEDD] text-[#8A6425]", dot: "bg-[#8A6425]" },
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
