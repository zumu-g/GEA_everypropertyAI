import { cn } from "@/lib/cn";

type SectionHeadingProps = {
  title: string;
  /** Small uppercase eyebrow above the title. */
  eyebrow?: string;
  icon?: React.ReactNode;
  /** Optional trailing content (actions, badges). */
  action?: React.ReactNode;
  className?: string;
};

/** Consistent section header: optional icon + eyebrow + sans title. */
export function SectionHeading({
  title,
  eyebrow,
  icon,
  action,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="flex items-center gap-3">
        {icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F4F5F7] text-[#6B7077]">
            {icon}
          </span>
        )}
        <div>
          {eyebrow && <p className="text-eyebrow text-[#8A8F97]">{eyebrow}</p>}
          <h2 className="text-h2 text-[#16181D]">{title}</h2>
        </div>
      </div>
      {action}
    </div>
  );
}
