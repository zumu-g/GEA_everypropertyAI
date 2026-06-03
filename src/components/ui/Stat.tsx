import { cn } from "@/lib/cn";

type StatProps = {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  /** Smaller variant for dense strips. */
  size?: "sm" | "md";
  className?: string;
};

/** Label + monospaced figure. The canonical data-cell. */
export function Stat({ label, value, icon, size = "md", className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-eyebrow text-[#8A8F97]">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 font-mono tabular-nums text-[#16181D]",
          size === "md" ? "text-lg font-medium" : "text-sm",
        )}
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {icon && <span className="text-[#8A8F97]">{icon}</span>}
        {value}
      </span>
    </div>
  );
}
