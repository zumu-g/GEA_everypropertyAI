/**
 * Coarse property class for comparable-sale matching. A land sale is never a
 * comparable for a house, and a unit is never one for a house, however the
 * source spelled the type ('Vacant land', 'ApartmentUnitFlat', 'Acreage / Semi-Rural').
 * Wider than values/suburb-values.ts::classifyPropertyType, which only knows the
 * two Valuer-General median classes.
 */
export type PropertyClass = 'house' | 'unit' | 'land' | 'rural';

export function propertyClass(t: string | null | undefined): PropertyClass | null {
  if (!t) return null;
  const s = t.toLowerCase();
  if (/\bland\b|vacant|block\b/.test(s)) return 'land';
  if (/acreage|rural|farm|lifestyle/.test(s)) return 'rural';
  if (/unit|apartment|flat|townhouse|villa|terrace|studio|retirement/.test(s)) return 'unit';
  if (/house|home|duplex|semi/.test(s)) return 'house';
  return null;
}

/** True when a comp of class `rowType` may be shown for a subject of class `subjectType`. */
export function sameClass(subjectType: string | null | undefined, rowType: string | null | undefined): boolean {
  const a = propertyClass(subjectType);
  const b = propertyClass(rowType);
  return !a || !b || a === b; // unknown on either side → don't exclude
}
