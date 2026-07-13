"use client";

import { useRef, useState } from "react";
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
  /** Defaults to true when omitted (the standalone /quadrant demo's hardcoded
   * segments). When false, the tile shows an insufficient-data state instead
   * of the low/avg/median figures. */
  sufficientData?: boolean;
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

// SVG geometry: a radial bar chart — concentric rings, one per segment, each
// sweeping clockwise from the top (12 o'clock) by an angle proportional to
// its value. 0deg is up; increasing degrees sweeps clockwise.
const VIEWBOX = 320;
const CENTER = VIEWBOX / 2;
const MAX_RADIUS = 118;
const HUB_RADIUS = 30;
const START_ANGLE_DEG = -90;
const MAX_SWEEP_DEG = 352; // leaves a seam so the largest bar never fully closes the ring
const TICK_COUNT = 6;

function pointAt(radius: number, angleDeg: number): { x: number; y: number } {
  const angle = angleDeg * (Math.PI / 180);
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

/** Arc path for a ring bar: fixed radius, sweeping clockwise from the top. */
function ringArcPath(radius: number, sweepDeg: number): string {
  const clamped = Math.min(Math.max(sweepDeg, 0), 359.9);
  const start = pointAt(radius, START_ANGLE_DEG);
  const end = pointAt(radius, START_ANGLE_DEG + clamped);
  const largeArc = clamped > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/** Ring-tint scale: darkest (full accent) at the centre, lightening outward. */
function ringTint(index: number, selected: boolean): string {
  if (selected) return "#2E5470";
  const opacity = Math.max(1 - index * 0.16, 0.32);
  return `rgba(46, 84, 112, ${opacity})`;
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
  // Escape sets editing=false, which unmounts this input; in real browsers that
  // unmount fires a blur event too, and without this guard commit() would read
  // the (stale, pre-reset) draft via its closure and save it anyway.
  const cancelledRef = useRef(false);

  const commit = () => {
    if (cancelledRef.current) return;
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
            cancelledRef.current = true;
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
        cancelledRef.current = false;
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
  const scaleMax = maxMedian * 1.15;
  const ringStep = (MAX_RADIUS - HUB_RADIUS) / Math.max(segments.length, 1);

  const segmentLabel = (s: QuadrantSegment) =>
    s.sufficientData === false
      ? `${s.name}: not enough recent sales data`
      : `${s.name}: low ${formatCurrency(s.low)}, average ${formatCurrency(s.avg)}, median ${formatCurrency(s.median)}`;

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

      {/* Radial bar chart: concentric rings, one per segment, sweeping clockwise
          from the top in proportion to its median. Labels live in the legend
          list below rather than on the chart, so nothing gets clipped. */}
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="mx-auto hidden w-full max-w-[360px] sm:block print:[print-color-adjust:exact]"
        role="img"
        aria-label={`Market position for ${targetAddress}: ${segments.map(segmentLabel).join("; ")}`}
      >
        {/* Angular scale ticks around the outer ring, like a clock face. */}
        {Array.from({ length: TICK_COUNT }, (_, i) => i + 1).map((i) => {
          const tickAngle = START_ANGLE_DEG + (MAX_SWEEP_DEG * i) / TICK_COUNT;
          const spoke = pointAt(MAX_RADIUS, tickAngle);
          const labelPt = pointAt(MAX_RADIUS + 16, tickAngle);
          return (
            <g key={i}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={spoke.x}
                y2={spoke.y}
                stroke="#EEF0F3"
                strokeWidth={1}
              />
              <text
                x={labelPt.x}
                y={labelPt.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-[#8A8F97] text-[9px]"
              >
                {formatCurrency(Math.round((scaleMax * i) / TICK_COUNT / 1000) * 1000)}
              </text>
            </g>
          );
        })}

        {/* Concentric grid circles, one per ring band. */}
        {segments.map((_, index) => (
          <circle
            key={index}
            cx={CENTER}
            cy={CENTER}
            r={HUB_RADIUS + ringStep * (index + 1)}
            fill="none"
            stroke="#E7E9EE"
            strokeWidth={1}
          />
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
          const ringRadius = HUB_RADIUS + ringStep * (index + 0.5);
          const sweepDeg =
            segment.sufficientData === false ? 0 : (segment.median / scaleMax) * MAX_SWEEP_DEG;

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
              className="cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2E5470]"
            >
              {sweepDeg > 0 && (
                <path
                  d={ringArcPath(ringRadius, sweepDeg)}
                  fill="none"
                  stroke={ringTint(index, selected)}
                  strokeWidth={selected ? ringStep * 0.85 : ringStep * 0.7}
                  strokeLinecap="round"
                  className="print:[print-color-adjust:exact]"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend: the value details for each segment, always visible (chart above is desktop-only). */}
      <div className="flex flex-col gap-3" data-testid="quadrant-legend">
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
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: ringTint(index, selected) }}
                    aria-hidden="true"
                  />
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
              {segment.sufficientData === false ? (
                <p className="text-center text-xs italic text-[#8A8F97]">Not enough recent sales</p>
              ) : (
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
              )}
            </div>
          );
        })}
      </div>

      <footer className="mt-6 flex items-center justify-between border-t border-[#E7E9EE] pt-4 text-xs text-[#8A8F97]">
        <span>© {new Date().getFullYear()} Grants Estate Agents</span>
        <span>{new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</span>
      </footer>
    </section>
  );
}
