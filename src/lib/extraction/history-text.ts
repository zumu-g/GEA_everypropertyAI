/**
 * Parse pasted property-history text (REA / Domain "Property history" panels, PriceFinder
 * exports, agent notes) into sale / lease records the /history endpoint accepts.
 *
 * Deterministic pass first: a "Sold" / "Leased" marker, a $ amount, and the next date
 * on or after it form one record. Listings ("Listed for sale") are returned too so the
 * user sees them, but there is no table for them — the UI marks them not stored.
 * The LLM cascade is only a fallback for text this misses (see the /history/parse route).
 */
export type ParsedKind = 'sale' | 'rental' | 'listing';

export interface ParsedHistoryRecord {
  kind: ParsedKind;
  /** YYYY-MM-DD */
  date: string;
  amount?: number;
  agency?: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

// "10 Jan 2013", "29 May 2004", "January 2013" (→ 1st), "10/01/2013"
const DATE_RE = /(?:(\d{1,2})\s+)?([A-Za-z]{3,9})\s+(\d{4})|(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const MONEY_RE = /\$\s?([\d,]+(?:\.\d+)?)/;
const AGENCY_RE = /\bby\s+(.+?)\s*$/i;

function toIso(m: RegExpMatchArray): string | null {
  if (m[3]) {
    const mm = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (!mm) return null;
    return `${m[3]}-${mm}-${(m[1] ?? '1').padStart(2, '0')}`;
  }
  return `${m[6]}-${m[5].padStart(2, '0')}-${m[4].padStart(2, '0')}`;
}

function kindOf(line: string): ParsedKind | null {
  const l = line.toLowerCase();
  if (/\b(sold|purchased)\b/.test(l)) return 'sale';
  if (/\b(leased|rented|let)\b/.test(l) || /\bpw\b|per week/.test(l)) return 'rental';
  if (/\blisted\b/.test(l)) return 'listing';
  return null;
}

export function parseHistoryText(text: string): ParsedHistoryRecord[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedHistoryRecord[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const kind = kindOf(lines[i]);
    if (!kind) continue;
    // Skip the year-only summary headers ("2013 Sold $450,000") — the detail lines follow.
    if (/^\d{4}\s+(sold|listed|leased)/i.test(lines[i]) && !DATE_RE.test(lines[i].replace(/^\d{4}\s+/, ''))) continue;

    // Look ahead a few lines for amount, date and agency belonging to this marker.
    let amount: number | undefined;
    let date: string | null = null;
    let agency: string | undefined;
    let dayOnly = false;
    for (let j = i; j < Math.min(i + 6, lines.length); j++) {
      const l = lines[j];
      if (j > i && kindOf(l) && kindOf(l) !== kind && /\$|\d{4}/.test(l)) break; // next event
      if (amount === undefined) {
        const m = l.match(MONEY_RE);
        if (m) amount = Number(m[1].replace(/,/g, ''));
      }
      // Take the first date; a day-precise one ("10 Jan 2013") later in the block
      // replaces a month-only one ("January 2013").
      const d = l.match(DATE_RE);
      if (d && (!date || (dayOnly && (d[1] || d[4])))) { date = toIso(d); dayOnly = !(d[1] || d[4]); }
      if (!agency) {
        const a = l.match(AGENCY_RE);
        if (a) agency = a[1].replace(/\s*-\s*$/, '').trim();
      }
    }
    if (!date) continue;
    if (kind !== 'listing' && !amount) continue;
    const key = `${kind}|${date}|${amount ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, date, amount, agency });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
