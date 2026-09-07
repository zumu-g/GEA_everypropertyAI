import type { PropertySaleRecord, SuburbMedianRecord } from '@/lib/db/queries';
import { isServiceAreaSuburb, SERVICE_AREA_SUBURBS } from '@/lib/utils/service-area';

// ─── Constants (KTD2) ────────────────────────────────────────────────────────

/** Same plausibility cap as market-segments/route.ts. */
export const MAX_PLAUSIBLE_SALE_PRICE = 50_000_000;

/** A computed "latest period" needs at least this many qualifying sales. */
export const MIN_SALES_FOR_COMPUTED_PERIOD = 10;

/** Same-sale dedupe window: sales within this many days of each other, on the same
 * address, are treated as one sale (portal re-listing vs the official register). */
export const DEDUPE_WINDOW_DAYS = 120;

/** Computed vs newest overlapping Valuer-General quarter: demote past this divergence. */
export const CALIBRATION_BAND = 0.1;

export const SCHEMA_VERSION = 1;

export type PropertyValueType = 'house' | 'unit';

export type ValuesReason = 'unmatched' | 'no-data' | 'thin-sample' | 'low-agreement' | 'suppressed';

export interface PeriodFigure {
  median: number;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  periodLabel: string; // e.g. "Dec 2025 quarter", "2021", "14 Jun 2026 – 12 Sep 2026"
  salesCount: number | null;
  source: 'valuer-general-quarter' | 'valuer-general-year' | 'property-sales-90d';
}

export interface ChangeFigure {
  percent: number | null;
  fromLabel: string | null;
  toLabel: string | null;
  reason: ValuesReason | null;
}

export interface SuburbTypeValues {
  latest: PeriodFigure | null;
  latestReason: ValuesReason | null;
  change3m: ChangeFigure;
  change12m: ChangeFigure;
  change5y: ChangeFigure;
  series: PeriodFigure[];
}

export interface SuburbValues {
  name: string;
  slug: string;
  houses: SuburbTypeValues;
  units: SuburbTypeValues;
}

export interface SuburbValuesPayload {
  schemaVersion: number;
  generatedAt: string;
  attribution: {
    valuerGeneral: string;
    everyproperty: string;
  };
  suburbs: SuburbValues[];
}

// ─── Property type classifier (mirrors market-segments/route.ts::isUnitType) ─

export function classifyPropertyType(propertyType: string | undefined | null): PropertyValueType | null {
  if (!propertyType) return null;
  const t = propertyType.toLowerCase();
  if (t.includes('unit') || t.includes('townhouse') || t.includes('apartment')) return 'unit';
  if (t.includes('house') || t.includes('home')) return 'house';
  return null;
}

// ─── Sale filtering + dedupe ──────────────────────────────────────────────────

function slugForSale(sale: PropertySaleRecord): string {
  if (sale.address_slug) return sale.address_slug;
  return sale.raw_address.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Priced, plausible, not a legacy aggregate row, within the service area. */
export function filterQualifyingSales(sales: PropertySaleRecord[]): PropertySaleRecord[] {
  return sales.filter(
    (s) =>
      isServiceAreaSuburb(s.suburb) &&
      typeof s.sale_price === 'number' &&
      s.sale_price > 0 &&
      s.sale_price <= MAX_PLAUSIBLE_SALE_PRICE &&
      s.source !== 'vic-vg-aggregate' &&
      !!s.sale_date
  );
}

/**
 * Collapses the same underlying sale reported by multiple sources (e.g. `domain`
 * and `vic-vg`) into one row: same address slug, sale dates within
 * DEDUPE_WINDOW_DAYS of each other. Prefers the `vic-vg` source's price when one
 * exists in the cluster, per KTD2.
 */
export function dedupeSales(sales: PropertySaleRecord[]): PropertySaleRecord[] {
  const bySlug = new Map<string, PropertySaleRecord[]>();
  for (const sale of sales) {
    const slug = slugForSale(sale);
    const list = bySlug.get(slug) ?? [];
    list.push(sale);
    bySlug.set(slug, list);
  }

  const out: PropertySaleRecord[] = [];
  for (const rows of bySlug.values()) {
    const sorted = [...rows].sort((a, b) => (a.sale_date ?? '').localeCompare(b.sale_date ?? ''));
    let cluster: PropertySaleRecord[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const vg = cluster.find((r) => r.source === 'vic-vg');
      out.push(vg ?? cluster[0]);
      cluster = [];
    };
    for (const row of sorted) {
      if (cluster.length === 0) {
        cluster.push(row);
        continue;
      }
      const last = cluster[cluster.length - 1];
      const gapDays = daysBetween(last.sale_date!, row.sale_date!);
      if (gapDays <= DEDUPE_WINDOW_DAYS) {
        cluster.push(row);
      } else {
        flush();
        cluster.push(row);
      }
    }
    flush();
  }
  return out;
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ─── Labels ────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function quarterLabel(periodStart: string): string {
  const d = new Date(periodStart);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} quarter`;
}

function yearLabel(periodStart: string): string {
  return String(new Date(periodStart).getUTCFullYear());
}

function dayRangeLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

function quarterToFigure(row: SuburbMedianRecord): PeriodFigure | null {
  if (row.median == null) return null;
  return {
    median: row.median,
    periodStart: row.period_start,
    periodEnd: row.period_start,
    periodLabel: quarterLabel(row.period_start),
    salesCount: row.sales_count,
    source: 'valuer-general-quarter',
  };
}

function yearToFigure(row: SuburbMedianRecord): PeriodFigure | null {
  if (row.median == null) return null;
  return {
    median: row.median,
    periodStart: row.period_start,
    periodEnd: row.period_start,
    periodLabel: yearLabel(row.period_start),
    salesCount: row.sales_count,
    source: 'valuer-general-year',
  };
}

// ─── Change maths ──────────────────────────────────────────────────────────

function percentChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

function changeAgainst(latest: PeriodFigure | null, prior: PeriodFigure | null, fallbackReason: ValuesReason): ChangeFigure {
  if (!latest) return { percent: null, fromLabel: null, toLabel: null, reason: fallbackReason };
  if (!prior) return { percent: null, fromLabel: null, toLabel: null, reason: 'no-data' };
  return {
    percent: percentChange(prior.median, latest.median),
    fromLabel: prior.periodLabel,
    toLabel: latest.periodLabel,
    reason: null,
  };
}

/** Closest quarter (preferred) or year row to a target date, within tolerance. */
function closestPeriod(
  quarters: SuburbMedianRecord[],
  years: SuburbMedianRecord[],
  targetIso: string,
  quarterToleranceDays: number,
  yearToleranceDays: number
): PeriodFigure | null {
  let best: { row: SuburbMedianRecord; diff: number } | null = null;
  for (const q of quarters) {
    if (q.median == null) continue;
    const diff = daysBetween(q.period_start, targetIso);
    if (diff <= quarterToleranceDays && (!best || diff < best.diff)) best = { row: q, diff };
  }
  if (best) return quarterToFigure(best.row);

  let bestYear: { row: SuburbMedianRecord; diff: number } | null = null;
  for (const y of years) {
    if (y.median == null) continue;
    const diff = daysBetween(y.period_start, targetIso);
    if (diff <= yearToleranceDays && (!bestYear || diff < bestYear.diff)) bestYear = { row: y, diff };
  }
  return bestYear ? yearToFigure(bestYear.row) : null;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Per suburb/type assembly ────────────────────────────────────────────────

function nullTypeValues(reason: ValuesReason): SuburbTypeValues {
  const nullChange: ChangeFigure = { percent: null, fromLabel: null, toLabel: null, reason };
  return {
    latest: null,
    latestReason: reason,
    change3m: nullChange,
    change12m: nullChange,
    change5y: nullChange,
    series: [],
  };
}

function buildSeries(quarters: SuburbMedianRecord[], years: SuburbMedianRecord[]): PeriodFigure[] {
  const quarterYears = new Set(quarters.map((q) => new Date(q.period_start).getUTCFullYear()));
  const out: PeriodFigure[] = [];
  for (const q of quarters) {
    const f = quarterToFigure(q);
    if (f) out.push(f);
  }
  for (const y of years) {
    if (quarterYears.has(new Date(y.period_start).getUTCFullYear())) continue; // quarters take priority (KTD2 backfill only fills gaps)
    const f = yearToFigure(y);
    if (f) out.push(f);
  }
  return out.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/** Core assembly for one suburb + property type. Pure function — no I/O. */
export function computeSuburbTypeValues(
  medianRows: SuburbMedianRecord[],
  qualifyingSales: PropertySaleRecord[]
): SuburbTypeValues {
  const quarters = medianRows.filter((r) => r.period_type === 'quarter').sort((a, b) => b.period_start.localeCompare(a.period_start));
  const years = medianRows.filter((r) => r.period_type === 'year').sort((a, b) => b.period_start.localeCompare(a.period_start));

  if (quarters.length === 0 && years.length === 0) {
    return nullTypeValues(qualifyingSales.length > 0 ? 'unmatched' : 'no-data');
  }

  const newestQuarter = quarters[0] ?? null;

  // Try the computed 90-day period.
  let computed: PeriodFigure | null = null;
  let computedFailReason: ValuesReason | null = null;
  if (qualifyingSales.length >= MIN_SALES_FOR_COMPUTED_PERIOD) {
    const prices = qualifyingSales.map((s) => s.sale_price as number);
    const computedMedian = median(prices);
    const newestQuarterMedian = newestQuarter?.median ?? null;
    if (newestQuarterMedian != null) {
      const divergence = Math.abs(computedMedian - newestQuarterMedian) / newestQuarterMedian;
      if (divergence > CALIBRATION_BAND) {
        computedFailReason = 'low-agreement';
      } else {
        computed = buildComputedFigure(computedMedian, qualifyingSales.length);
      }
    } else {
      // No overlapping VG quarter to calibrate against — nothing to compare, allow it.
      computed = buildComputedFigure(computedMedian, qualifyingSales.length);
    }
  } else {
    computedFailReason = 'thin-sample';
  }

  let latest: PeriodFigure | null;
  let latestReason: ValuesReason | null;
  let priorForShortTerm: PeriodFigure | null;

  if (computed) {
    latest = computed;
    latestReason = null;
    priorForShortTerm = newestQuarter ? quarterToFigure(newestQuarter) : null;
  } else if (newestQuarter && newestQuarter.median != null) {
    latest = quarterToFigure(newestQuarter);
    latestReason = computedFailReason; // informational: why the computed period wasn't used
    priorForShortTerm = quarters[1] ? quarterToFigure(quarters[1]) : null;
  } else if (newestQuarter) {
    // Newest quarter row exists but its median is null (suppressed by the VG).
    latest = null;
    latestReason = 'suppressed';
    priorForShortTerm = null;
  } else {
    latest = null;
    latestReason = computedFailReason ?? 'no-data';
    priorForShortTerm = null;
  }

  const change3m = changeAgainst(latest, priorForShortTerm, latestReason ?? 'no-data');

  let change12m: ChangeFigure;
  let change5y: ChangeFigure;
  if (!latest) {
    const nullChange: ChangeFigure = { percent: null, fromLabel: null, toLabel: null, reason: latestReason };
    change12m = nullChange;
    change5y = nullChange;
  } else {
    const target12m = addDaysIso(latest.periodStart, -365);
    const prior12m = closestPeriod(quarters, years, target12m, 60, 200);
    change12m = changeAgainst(latest, prior12m, 'no-data');

    const target5y = addDaysIso(latest.periodStart, -365 * 5);
    const prior5y = closestPeriod(quarters, years, target5y, 60, 200);
    change5y = changeAgainst(latest, prior5y, 'no-data');
  }

  return {
    latest,
    latestReason,
    change3m,
    change12m,
    change5y,
    series: buildSeries(quarters, years),
  };
}

function buildComputedFigure(computedMedian: number, count: number): PeriodFigure {
  const periodEnd = new Date().toISOString().slice(0, 10);
  const periodStart = addDaysIso(periodEnd, -90);
  return {
    median: computedMedian,
    periodStart,
    periodEnd,
    periodLabel: dayRangeLabel(periodStart, periodEnd),
    salesCount: count,
    source: 'property-sales-90d',
  };
}

function slugify(suburb: string): string {
  return suburb.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Full payload assembly (pure — no I/O). Takes every suburb_medians row and
 * every priced sale in the 90-day window (unfiltered/undeduped is fine, this
 * function does the filtering and dedupe) and produces the Casey/Cardinia
 * values payload for every service-area suburb.
 */
export function assembleSuburbValues(
  medianRows: SuburbMedianRecord[],
  recentSales: PropertySaleRecord[],
  generatedAt: string = new Date().toISOString()
): SuburbValuesPayload {
  const qualifying = dedupeSales(filterQualifyingSales(recentSales));

  const medianBySuburb = new Map<string, SuburbMedianRecord[]>();
  for (const row of medianRows) {
    const key = row.suburb.toLowerCase();
    const list = medianBySuburb.get(key) ?? [];
    list.push(row);
    medianBySuburb.set(key, list);
  }

  const salesBySuburbType = new Map<string, PropertySaleRecord[]>();
  for (const sale of qualifying) {
    const type = classifyPropertyType(sale.property_type);
    if (!type) continue;
    const key = `${(sale.suburb ?? '').toLowerCase()}::${type}`;
    const list = salesBySuburbType.get(key) ?? [];
    list.push(sale);
    salesBySuburbType.set(key, list);
  }

  const suburbs: SuburbValues[] = SERVICE_AREA_SUBURBS.map((name) => {
    const key = name.toLowerCase();
    const rows = medianBySuburb.get(key) ?? [];
    const houseRows = rows.filter((r) => r.property_type === 'house');
    const unitRows = rows.filter((r) => r.property_type === 'unit');
    const houseSales = salesBySuburbType.get(`${key}::house`) ?? [];
    const unitSales = salesBySuburbType.get(`${key}::unit`) ?? [];

    return {
      name,
      slug: slugify(name),
      houses: computeSuburbTypeValues(houseRows, houseSales),
      units: computeSuburbTypeValues(unitRows, unitSales),
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    attribution: {
      valuerGeneral: 'Sales data: © State of Victoria (Valuer-General Victoria), CC-BY 4.0',
      everyproperty: 'Recent-quarter figures computed by EveryProperty from property_sales',
    },
    suburbs,
  };
}
