"use client";

import { useState } from "react";
import { Building2, BedDouble, Home } from "lucide-react";
import { cn } from "@/lib/cn";

export interface QuadrantSegment {
  name: string;
  low: number;
  avg: number;
  median: number;
  /** Optional icon override; falls back to a name-based heuristic. */
  icon?: React.ReactNode;
}

export interface QuadrantChartState {
  segments: QuadrantSegment[];
  targetAddress: string;
  selectedIndex: number | null;
}

export interface QuadrantChartProps {
  segments?: QuadrantSegment[];
  targetAddress?: string;
  suburb?: string;
  dataDate?: string;
  onChange?: (state: QuadrantChartState) => void;
}

const DEFAULT_SEGMENTS: QuadrantSegment[] = [
  { name: "Units / townhouses", low: 520_000, avg: 605_000, median: 590_000 },
  { name: "3 bedroom homes", low: 640_000, avg: 715_000, median: 700_000 },
  { name: "4 bedroom homes", low: 760_000, avg: 850_000, median: 835_000 },
  { name: "5+ bedroom homes", low: 950_000, avg: 1_100_000, median: 1_050_000 },
];

const DEFAULT_ADDRESS = "9 Gloucester Ave, Berwick VIC 3806";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Digits-only parse; returns null when the input has no usable number. */
function parseCurrencyInput(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function segmentIcon(name: string): React.ReactNode {
  const lower = name.toLowerCase();
  if (lower.includes("unit") || lower.includes("townhouse")) {
    return <Building2 className="h-5 w-5" aria-hidden="true" />;
  }
  if (lower.includes("bed")) {
    return <BedDouble className="h-5 w-5" aria-hidden="true" />;
  }
  return <Home className="h-5 w-5" aria-hidden="true" />;
}

/** Self-contained click-to-edit / blur-to-save text field. Reverts to the last
 * valid value on blur if left empty/whitespace-only. */
function EditableField({
  value,
  onSave,
  label,
  className,
  displayClassName,
  format,
  parse,
}: {
  value: string;
  onSave: (next: string) => void;
  label: string;
  className?: string;
  displayClassName?: string;
  format?: (v: string) => string;
  parse?: (raw: string) => string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const parsed = parse ? parse(draft) : draft.trim() || null;
    onSave(parsed && parsed.trim() ? parsed : value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label={label}
        className={cn(
          "rounded-lg border border-[#2E5470] bg-white px-2 py-1 outline-none focus:ring-2 focus:ring-[#2E5470]/30",
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      title={`Edit ${label}`}
      aria-label={`Edit ${label}`}
      className={cn(
        "print:pointer-events-none rounded-md text-left outline-none hover:bg-[#F4F5F7] focus-visible:ring-2 focus-visible:ring-[#2E5470]/30",
        displayClassName,
      )}
    >
      {format ? format(value) : value}
    </button>
  );
}

export function QuadrantChart({
  segments: segmentsProp,
  targetAddress: addressProp,
  suburb,
  dataDate,
  onChange,
}: QuadrantChartProps) {
  const [segments, setSegments] = useState<QuadrantSegment[]>(
    segmentsProp ?? DEFAULT_SEGMENTS,
  );
  const [targetAddress, setTargetAddress] = useState(
    addressProp ?? DEFAULT_ADDRESS,
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  const emit = (next: Partial<QuadrantChartState>) => {
    const state: QuadrantChartState = {
      segments: next.segments ?? segments,
      targetAddress: next.targetAddress ?? targetAddress,
      selectedIndex:
        next.selectedIndex !== undefined ? next.selectedIndex : selectedIndex,
    };
    onChange?.(state);
  };

  const updateSegment = (
    index: number,
    field: keyof Omit<QuadrantSegment, "icon">,
    value: string,
  ) => {
    const next = segments.map((s, i) => {
      if (i !== index) return s;
      if (field === "name") return { ...s, name: value };
      const parsed = parseCurrencyInput(value);
      return parsed === null ? s : { ...s, [field]: parsed };
    });
    setSegments(next);
    emit({ segments: next });
  };

  const toggleSelected = (index: number) => {
    const next = selectedIndex === index ? null : index;
    setSelectedIndex(next);
    emit({ selectedIndex: next });
  };

  const handleAddressSave = (next: string) => {
    setTargetAddress(next);
    emit({ targetAddress: next });
  };

  const handleCopySummary = async () => {
    const lines = segments.map(
      (s) =>
        `${s.name}: Low ${formatCurrency(s.low)}, Avg ${formatCurrency(s.avg)}, Median ${formatCurrency(s.median)}`,
    );
    const text = [
      targetAddress,
      suburb ? `${suburb}${dataDate ? ` — ${dataDate}` : ""}` : dataDate,
      "",
      ...lines,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <section
      className="rounded-xl border border-[#E7E9EE] bg-white p-6 print:border-0 print:p-0"
      aria-label="Market position quadrant chart"
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[#E7E9EE] pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#8A8F97]">
            Market position
          </p>
          <EditableField
            value={targetAddress}
            onSave={handleAddressSave}
            label="target property address"
            className="text-xl font-semibold text-[#16181D]"
            displayClassName="text-xl font-semibold text-[#16181D] -mx-2 px-2"
          />
          {(suburb || dataDate) && (
            <p className="mt-1 text-sm text-[#6B7077]">
              {suburb}
              {suburb && dataDate && " · "}
              {dataDate}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopySummary}
          className="print:hidden rounded-lg border border-[#E7E9EE] px-3 py-1.5 text-xs font-medium text-[#4A4E57] transition-colors hover:border-[#2E5470] hover:text-[#2E5470]"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy failed — select text manually"
              : "Copy summary"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {segments.map((segment, index) => {
          const selected = selectedIndex === index;
          return (
            // Not a <button>: it contains nested interactive edit fields, and
            // interactive content cannot nest inside <button> per HTML spec.
            <div
              key={index}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${segment.name} — mark as most similar to yours`}
              onClick={() => toggleSelected(index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSelected(index);
                }
              }}
              className={cn(
                "print:[print-color-adjust:exact] flex cursor-pointer flex-col gap-3 rounded-xl border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#2E5470]/30",
                selected
                  ? "border-[#2E5470] bg-[#E4EBF1]"
                  : "border-[#E7E9EE] bg-[#FBFBFC] hover:border-[#2E5470]/50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[#2E5470]">
                  {segment.icon ?? segmentIcon(segment.name)}
                  <EditableField
                    value={segment.name}
                    onSave={(v) => updateSegment(index, "name", v)}
                    label={`${segment.name} segment name`}
                    className="text-sm font-semibold text-[#16181D]"
                    displayClassName="text-sm font-semibold text-[#16181D] -mx-1 px-1"
                  />
                </div>
                {selected && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2E5470] px-2.5 py-0.5 text-xs font-medium text-white">
                    Most similar to yours
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-3 gap-2 text-center">
                {(["low", "avg", "median"] as const).map((field) => (
                  <div key={field}>
                    <dt className="text-[10px] uppercase tracking-wide text-[#8A8F97]">
                      {field === "avg" ? "Average" : field === "low" ? "Low" : "Median"}
                    </dt>
                    <dd className="tabular-nums">
                      <EditableField
                        value={String(segment[field])}
                        onSave={(v) => updateSegment(index, field, v)}
                        label={`${segment.name} ${field} price`}
                        format={(v) => formatCurrency(Number(v))}
                        parse={(raw) => {
                          const parsed = parseCurrencyInput(raw);
                          return parsed === null ? null : String(parsed);
                        }}
                        className="w-24 text-sm font-medium text-[#16181D]"
                        displayClassName="text-sm font-medium text-[#16181D]"
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>

      <footer className="mt-6 flex items-center justify-between border-t border-[#E7E9EE] pt-4 text-xs text-[#8A8F97]">
        <span>Prepared by Grants Estate Agents</span>
        <span>{new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</span>
      </footer>
    </section>
  );
}
