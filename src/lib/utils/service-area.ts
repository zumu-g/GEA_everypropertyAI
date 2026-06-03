/**
 * Service area = City of Casey + Shire of Cardinia ONLY.
 *
 * PropertyIQ intentionally restricts all stored/served property data to these
 * two LGAs. The batch scraper (scripts/ingest-domain-apify.mjs) is scoped to
 * in-area suburb slugs, but a suburb page can surface neighbouring localities,
 * so ingest also filters every row through isServiceAreaSuburb() as a hard guard
 * — nothing outside Casey/Cardinia is written.
 *
 * Names are the canonical Domain/title-case localities, compared case-insensitively.
 * Keep this list in sync with the mirror in scripts/ingest-domain-apify.mjs
 * (the .mjs can't import TS).
 */

// City of Casey localities.
const CASEY = [
  'Berwick', 'Blind Bight', 'Botanic Ridge', 'Cannons Creek', 'Clyde', 'Clyde North',
  'Cranbourne', 'Cranbourne East', 'Cranbourne North', 'Cranbourne South', 'Cranbourne West',
  'Devon Meadows', 'Doveton', 'Endeavour Hills', 'Eumemmerring', 'Five Ways', 'Hallam',
  'Hampton Park', 'Harkaway', 'Junction Village', 'Lynbrook', 'Lyndhurst', 'Lysterfield South',
  'Narre Warren', 'Narre Warren East', 'Narre Warren North', 'Narre Warren South',
  'Pearcedale', 'Sandhurst', 'Skye', 'Tooradin', 'Warneet',
];

// Shire of Cardinia localities.
const CARDINIA = [
  'Athlone', 'Avonsleigh', 'Bayles', 'Beaconsfield', 'Beaconsfield Upper', 'Bunyip',
  'Bunyip North', 'Caldermeade', 'Cardinia', 'Catani', 'Clematis', 'Cockatoo', 'Cora Lynn',
  'Dalmore', 'Dewhurst', 'Emerald', 'Garfield', 'Garfield North', 'Gembrook', 'Guys Hill',
  'Heath Hill', 'Iona', 'Koo Wee Rup', 'Koo Wee Rup North', 'Lang Lang', 'Lang Lang East',
  'Maryknoll', 'Modella', 'Monomeith', 'Mount Burnett', 'Nangana', 'Nar Nar Goon',
  'Nar Nar Goon North', 'Officer', 'Officer South', 'Pakenham', 'Pakenham South',
  'Pakenham Upper', 'Ripplebrook', 'Rythdale', 'Tonimbuk', 'Toomuc Valley', 'Tynong',
  'Tynong North', 'Vervale', 'Yannathan',
];

/** Canonical Casey + Cardinia suburb names (title case). */
export const SERVICE_AREA_SUBURBS: readonly string[] = [...CASEY, ...CARDINIA];

const SERVICE_AREA_SET = new Set(SERVICE_AREA_SUBURBS.map((s) => s.toLowerCase()));

/** True if a suburb is within the Casey/Cardinia service area (case-insensitive). */
export function isServiceAreaSuburb(suburb: string | null | undefined): boolean {
  if (!suburb) return false;
  return SERVICE_AREA_SET.has(suburb.trim().toLowerCase());
}
