"use client";

import { useState } from "react";
import { Building2, BedDouble, Home } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format-currency";
import { Badge } from "@/components/ui/Badge";

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

// SVG geometry: 0deg is up, segments placed clockwise at 90deg intervals.
const VIEWBOX = 320;
const CENTER = VIEWBOX / 2;
const MAX_RADIUS = 110;
const HUB_RADIUS = 22;
const GRIDLINE_FRACTIONS = [0.5, 1];

function angleFor(index: number): number {
  return (index * 90 - 90) * (Math.PI / 180);
}

function pointAt(radius: number, angle: number): { x: number; y: number } {
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
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
    return <Building2 className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower.includes("bed")) {
    return <BedDouble className="h-4 w-4" aria-hidden="true" />;
  }
  return <Home className="h-4 w-4" aria-hidden="true" />;
}

/** Self-contained click-to-edit / blur-to-save text field. Reverts to the last
 * valid value on blur if left empty/whitespace-only. Guards click/keydown so
 * they never bubble to a selectable ancestor (e.g. the segment bar). */
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
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label={label}
        className={cn(
          "rounded-lg border border-[#2E5470] bg-white px-2 py-1 outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-2",
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
      onKeyDown={(e) => e.stopPropagation()}
      title={`Edit ${label}`}
      aria-label={`Edit ${label}`}
      className={cn(
        "print:pointer-events-none rounded-md text-left outline-none hover:bg-[#F4F5F7] focus-visible:ring-2 focus-visible:ring-[#2E5470] focus-visible:ring-offset-2",
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

  const maxMedian = Math.max(...segments.map((s) => s.median), 1);

  const segmentLabel = (s: QuadrantSegment) =>
    `${s.name}: low ${formatCurrency(s.low)}, average ${formatCurrency(s.avg)}, median ${formatCurrency(s.median)}`;

  return (
    <section
      className="rounded-xl border border-[#E7E9EE] bg-white p-6 print:border-0 print:p-0"
      aria-label="Market position radial bar chart"
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
          className="print:hidden rounded-lg border border-[#E7E9EE] px-3 py-1.5 text-xs font-medium text-[#4A4E57] outline-none transition-colors hover:border-[#2E5470] hover:text-[#2E5470] focus-visible:ring-2 focus-visible:ring-[#2E5470] focus-visible:ring-offset-2"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy failed — select text manually"
              : "Copy summary"}
        </button>
      </header>

      {/* Radial chart: hidden below the sm breakpoint in favour of a stacked list. */}
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="mx-auto hidden w-full max-w-[420px] sm:block print:[print-color-adjust:exact]"
        role="img"
        aria-label={`Market position for ${targetAddress}: ${segments.map(segmentLabel).join("; ")}`}
      >
        {GRIDLINE_FRACTIONS.map((f) => (
          <g key={f}>
            <circle
              cx={CENTER}
              cy={CENTER}
              r={HUB_RADIUS + f * (MAX_RADIUS - HUB_RADIUS)}
              fill="none"
              stroke="#E7E9EE"
              strokeWidth={1}
            />
            <text
              x={CENTER + 4}
              y={CENTER - (HUB_RADIUS + f * (MAX_RADIUS - HUB_RADIUS)) - 2}
              className="fill-[#8A8F97] text-[9px]"
            >
              {formatCurrency(Math.round((maxMedian * f) / 1000) * 1000)}
            </text>
          </g>
        ))}
        <circle cx={CENTER} cy={CENTER} r={HUB_RADIUS} fill="#F4F5F7" stroke="#E7E9EE" />
        <text
          x={CENTER}
          y={CENTER}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-[#4A4E57] text-[8px] font-medium"
        >
          Subject
        </text>

        {segments.map((segment, index) => {
          const selected = selectedIndex === index;
          const angle = angleFor(index);
          const barLength = HUB_RADIUS + (segment.median / maxMedian) * (MAX_RADIUS - HUB_RADIUS);
          const tip = pointAt(barLength, angle);
          const labelAnchor = pointAt(MAX_RADIUS + 18, angle);
          const labelWidth = 128;
          const labelHeight = 78;

          return (
            <g
              key={index}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={segmentLabel(segment)}
              onClick={() => toggleSelected(index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSelected(index);
                }
              }}
              className="cursor-pointer outline-none"
            >
              <line
                x1={CENTER}
                y1={CENTER}
                x2={tip.x}
                y2={tip.y}
                stroke={selected ? "#2E5470" : "#5C7466"}
                strokeWidth={selected ? 10 : 7}
                strokeLinecap="round"
                className="print:[print-color-adjust:exact]"
              />
              <circle
                cx={tip.x}
                cy={tip.y}
                r={selected ? 7 : 5}
                fill={selected ? "#2E5470" : "#5C7466"}
              />
              <foreignObject
                x={labelAnchor.x - labelWidth / 2}
                y={labelAnchor.y - (angle < 0 ? labelHeight : 0)}
                width={labelWidth}
                height={labelHeight}
                className="overflow-visible"
              >
                <div
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg border p-2 text-center",
                    selected
                      ? "border-[#2E5470] bg-[#E4EBF1]"
                      : "border-[#E7E9EE] bg-[#FBFBFC]",
                  )}
                >
                  <div className="flex items-center gap-1 text-[#2E5470]">
                    {segment.icon ?? segmentIcon(segment.name)}
                    <EditableField
                      value={segment.name}
                      onSave={(v) => updateSegment(index, "name", v)}
                      label={`${segment.name} segment name`}
                      className="text-xs font-semibold text-[#16181D]"
                      displayClassName="text-xs font-semibold text-[#16181D] -mx-1 px-1"
                    />
                  </div>
                  {selected && <Badge tone="accent">Most similar to yours</Badge>}
                  <div className="flex gap-1.5 text-[10px] tabular-nums">
                    {(["low", "avg", "median"] as const).map((field) => (
                      <EditableField
                        key={field}
                        value={String(segment[field])}
                        onSave={(v) => updateSegment(index, field, v)}
                        label={`${segment.name} ${field} price`}
                        format={(v) => formatCurrency(Number(v))}
                        parse={(raw) => {
                          const parsed = parseCurrencyInput(raw);
                          return parsed === null ? null : String(parsed);
                        }}
                        className="w-16 text-[10px] font-medium text-[#16181D]"
                        displayClassName="text-[10px] font-medium text-[#16181D]"
                      />
                    ))}
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>

      {/* Mobile fallback: stacked list, chart not shown below sm. */}
      <div className="flex flex-col gap-3 sm:hidden" data-testid="quadrant-stacked-fallback">
        {segments.map((segment, index) => {
          const selected = selectedIndex === index;
          return (
            <div
              key={index}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={segmentLabel(segment)}
              onClick={() => toggleSelected(index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSelected(index);
                }
              }}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-xl border p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#2E5470] focus-visible:ring-offset-2",
                selected
                  ? "border-[#2E5470] bg-[#E4EBF1]"
                  : "border-[#E7E9EE] bg-[#FBFBFC]",
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
                {selected && <Badge tone="accent">Most similar to yours</Badge>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(["low", "avg", "median"] as const).map((field) => (
                  <div key={field}>
                    <p className="text-[10px] uppercase tracking-wide text-[#8A8F97]">
                      {field === "avg" ? "Average" : field === "low" ? "Low" : "Median"}
                    </p>
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
                  </div>
                ))}
              </div>
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
