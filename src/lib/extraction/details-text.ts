/**
 * Pull property attributes (type, beds, baths, cars, land, building) out of a pasted
 * REA / PropTrack property page. Keys match the /override endpoint's ALLOWED_FIELDS.
 * Prefers the "About the property" sentence; falls back to REA's header stack
 * (type line, then bed / bath / car as bare numbers, then land and building m²).
 */
export interface ParsedDetails {
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landArea?: number;
  buildingArea?: number;
}

const TYPE_RE = /^(house|unit|apartment|townhouse|villa|duplex|semi-detached|studio|land|acreage|rural|terrace)$/i;
const num = (s: string) => Number(s.replace(/,/g, ''));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function parseDetailsText(text: string): ParsedDetails {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedDetails = {};
  const set = <K extends keyof ParsedDetails>(k: K, v: ParsedDetails[K]) => {
    if (out[k] === undefined && v !== undefined && !(typeof v === 'number' && !(v >= 0))) out[k] = v;
  };

  const about = lines.find((l) => /\b\d+\s+bed(room)?s?\b/i.test(l)) ?? '';
  const m = (re: RegExp) => about.match(re)?.[1];
  if (m(/(\d+)\s+bed/i)) set('bedrooms', num(m(/(\d+)\s+bed/i)!));
  if (m(/(\d+)\s+bath/i)) set('bathrooms', num(m(/(\d+)\s+bath/i)!));
  if (m(/(\d+)\s+car/i)) set('carSpaces', num(m(/(\d+)\s+car/i)!));
  if (m(/([\d,]+)\s?m²\s+(?:lot|block|land)/i)) set('landArea', num(m(/([\d,]+)\s?m²\s+(?:lot|block|land)/i)!));
  const aboutType = about.match(/\b(house|unit|apartment|townhouse|villa|duplex|studio|land|acreage|terrace)\b/i)?.[1];

  // Header stack: "House", then three bare numbers (bed, bath, car), then m² lines.
  const ti = lines.findIndex((l) => TYPE_RE.test(l));
  if (ti >= 0) {
    set('propertyType', cap(lines[ti]));
    const nums: number[] = [];
    const areas: number[] = [];
    for (const l of lines.slice(ti + 1, ti + 12)) {
      const a = l.match(/^([\d,]+)\s?m²$/i);
      if (a) areas.push(num(a[1]));
      else if (/^\d{1,2}$/.test(l) && areas.length === 0 && nums.length < 3) nums.push(Number(l));
    }
    set('bedrooms', nums[0]);
    set('bathrooms', nums[1]);
    set('carSpaces', nums[2]);
    set('landArea', areas[0]);
    set('buildingArea', areas[1]);
  } else if (aboutType) {
    set('propertyType', cap(aboutType));
  }
  return out;
}
