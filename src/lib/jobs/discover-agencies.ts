/**
 * Agency Discovery Job
 *
 * One-shot job that discovers and populates the `agencies` Supabase table by
 * scraping franchise office-finder pages and the REIV member directory.
 *
 * Uses direct HTTP fetch — NOT Firecrawl — to avoid costs on this meta-task.
 */

import { CASEY_CARDINIA_AGENCIES } from '@/lib/firecrawl/sources/agencies';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/db/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiscoveredAgency {
  name: string;
  website: string;
  suburb?: string;
  state: string;
  postcode?: string;
  franchise_group?: string;
  search_pattern?: string;
  suburbs_covered?: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const USER_AGENT = 'PropertyIQ/1.0 (+https://propertyiq.com.au)';
const FETCH_TIMEOUT_MS = 15000;

/** Known franchise search pattern templates. {query} will be URI-encoded. */
const FRANCHISE_PATTERNS: Record<string, string> = {
  'Ray White':    '/properties?search={query}',
  'Harcourts':   '/properties?search={query}',
  'Barry Plant':  '/buy?search={query}',
  'LJ Hooker':   '/search?q={query}',
  'McGrath':     '/properties?search={query}',
  'Jellis Craig': '/properties-for-sale/?search={query}',
};

/** Default fallback search pattern. */
const DEFAULT_SEARCH_PATTERN = '/properties?search={query}';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fetch page HTML as a string, returning null on failure. */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[discover-agencies] HTTP ${response.status} for ${url}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[discover-agencies] Fetch failed for ${url}: ${msg}`);
    return null;
  }
}

/** Extract all href values that look like office/branch sub-pages. */
function extractOfficeLinks(html: string, baseUrl: string): string[] {
  // Match href="/...office..." or href="https://...office..." type patterns
  const hrefPattern = /href=["']([^"']+)["']/gi;
  const links = new Set<string>();
  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[1];
    try {
      const resolved = new URL(href, baseUrl).toString();
      // Only keep links from the same host and that look like office/suburb paths
      const base = new URL(baseUrl);
      const resolved_ = new URL(resolved);
      if (resolved_.hostname === base.hostname) {
        links.add(resolved);
      }
    } catch {
      // Ignore non-URL hrefs (#anchors, javascript:, etc.)
    }
  }
  return [...links];
}

/**
 * Extract text that looks like suburb or office names from an HTML snippet.
 * Strips HTML tags and collapses whitespace.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parse office cards from HTML using common patterns across franchise sites. */
function extractOfficeCards(
  html: string,
  franchiseGroup: string,
  pageUrl: string
): DiscoveredAgency[] {
  const agencies: DiscoveredAgency[] = [];

  // Strategy: look for anchor tags with suburb-like href paths, extract nearby text
  // This regex targets: <a href="/office/suburb-name">...</a> or similar
  const cardPattern =
    /<a[^>]+href=["']([^"'#?]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;

  let match;
  while ((match = cardPattern.exec(html)) !== null) {
    const href = match[1];
    const innerText = stripTags(match[2]).trim();

    // Skip short/empty inner text and nav/utility links
    if (!innerText || innerText.length < 3 || innerText.length > 120) continue;

    // Skip links that don't look like office pages
    const hrefLower = href.toLowerCase();
    const isOfficePath =
      /\/(office|branch|team|suburb|location|contact|find)s?\//i.test(hrefLower) ||
      hrefLower.includes('/offices') ||
      hrefLower.includes('/our-offices') ||
      hrefLower.includes('/office/');

    if (!isOfficePath) continue;

    // Resolve absolute URL
    let website: string;
    try {
      website = new URL(href, pageUrl).toString();
      // Strip trailing slashes for consistency
      website = website.replace(/\/$/, '');
    } catch {
      continue;
    }

    // Derive suburb from either the innerText or the href slug
    const slug = href.split('/').filter(Boolean).pop() ?? '';
    const suburbFromSlug = slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    const suburb = suburbFromSlug || innerText;
    const name = innerText || `${franchiseGroup} ${suburbFromSlug}`;

    agencies.push({
      name: `${franchiseGroup} ${suburb}`.trim(),
      website,
      suburb,
      state: 'VIC',
      franchise_group: franchiseGroup,
    });
  }

  return agencies;
}

// ─── Franchise Scrapers ───────────────────────────────────────────────────────

interface FranchisePage {
  url: string;
  franchise_group: string;
}

const FRANCHISE_PAGES: FranchisePage[] = [
  { url: 'https://raywhite.com.au/find-office/?state=VIC',          franchise_group: 'Ray White' },
  { url: 'https://www.harcourts.com.au/Home/Offices?state=VIC',     franchise_group: 'Harcourts' },
  { url: 'https://www.barryplant.com.au/offices',                   franchise_group: 'Barry Plant' },
  { url: 'https://www.ljhooker.com.au/offices?state=VIC',           franchise_group: 'LJ Hooker' },
  { url: 'https://www.mcgrath.com.au/agents/offices?state=VIC',     franchise_group: 'McGrath' },
  { url: 'https://www.jelliscraig.com.au/our-offices',              franchise_group: 'Jellis Craig' },
  { url: 'https://www.marshallwhite.com.au/about/our-offices',      franchise_group: 'Marshall White' },
  { url: 'https://nelsonalexander.com.au/offices/',                 franchise_group: 'Nelson Alexander' },
  { url: 'https://www.woodards.com.au/offices/',                    franchise_group: 'Woodards' },
  { url: 'https://www.fletchers.com.au/our-offices/',               franchise_group: 'Fletchers' },
  { url: 'https://www.noeljones.com.au/our-offices',                franchise_group: 'Noel Jones' },
  { url: 'https://www.bigginscott.com.au/offices',                  franchise_group: 'Biggin & Scott' },
];

/**
 * Scrapes major Australian franchise "find an office" pages to discover VIC branches.
 * Returns one DiscoveredAgency per detected office.
 */
export async function discoverFromFranchisePages(): Promise<DiscoveredAgency[]> {
  const results = await Promise.allSettled(
    FRANCHISE_PAGES.map(async ({ url, franchise_group }) => {
      console.log(`[discover-agencies] Fetching ${franchise_group}: ${url}`);
      const html = await fetchHtml(url);
      if (!html) return [] as DiscoveredAgency[];

      const cards = extractOfficeCards(html, franchise_group, url);

      // Deduplicate by website within this franchise
      const seen = new Set<string>();
      return cards.filter((a) => {
        if (seen.has(a.website)) return false;
        seen.add(a.website);
        return true;
      });
    })
  );

  const all: DiscoveredAgency[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      all.push(...r.value);
    }
  }

  console.log(`[discover-agencies] Franchise pages yielded ${all.length} offices`);
  return all;
}

/**
 * Scrapes the REIV member directory to discover additional agencies.
 */
export async function discoverFromReivDirectory(): Promise<DiscoveredAgency[]> {
  const url = 'https://reiv.com.au/choose-a-member?search=melbourne';
  console.log(`[discover-agencies] Fetching REIV directory: ${url}`);

  const html = await fetchHtml(url);
  if (!html) return [];

  const agencies: DiscoveredAgency[] = [];

  // REIV results often contain member name + linked website
  // Look for anchor tags with external http links near member name text
  const memberPattern =
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;

  let match;
  while ((match = memberPattern.exec(html)) !== null) {
    const website = match[1].replace(/\/$/, '');
    const nameRaw = stripTags(match[2]).trim();

    // Skip REIV's own links and very short/long names
    if (
      !nameRaw ||
      nameRaw.length < 3 ||
      nameRaw.length > 100 ||
      website.includes('reiv.com.au') ||
      website.includes('facebook.com') ||
      website.includes('linkedin.com') ||
      website.includes('instagram.com')
    ) {
      continue;
    }

    // Only include agencies that look like real estate businesses
    const nameLC = nameRaw.toLowerCase();
    const isRealEstate =
      nameLC.includes('real estate') ||
      nameLC.includes('property') ||
      nameLC.includes('realty') ||
      nameLC.includes('agency') ||
      nameLC.includes('agent') ||
      nameLC.includes('harcourts') ||
      nameLC.includes('ray white') ||
      nameLC.includes('barry plant') ||
      nameLC.includes('ljhooker') ||
      nameLC.includes('lj hooker') ||
      nameLC.includes('first national') ||
      nameLC.includes('stockdale') ||
      nameLC.includes('raine') ||
      nameLC.includes('jellis') ||
      nameLC.includes("o'brien") ||
      nameLC.includes('fletchers');

    if (!isRealEstate) continue;

    agencies.push({
      name: nameRaw,
      website,
      state: 'VIC',
      franchise_group: undefined,
    });
  }

  // Deduplicate by website
  const seen = new Set<string>();
  const deduped = agencies.filter((a) => {
    if (seen.has(a.website)) return false;
    seen.add(a.website);
    return true;
  });

  console.log(`[discover-agencies] REIV directory yielded ${deduped.length} agencies`);
  return deduped;
}

// ─── Search Pattern Inference ─────────────────────────────────────────────────

/**
 * Given a known agency website, infer the most likely search URL pattern.
 * Uses franchise-specific overrides where known, then falls back to common patterns.
 */
export function inferSearchPattern(website: string, franchiseGroup?: string): string {
  if (franchiseGroup) {
    // Check for exact franchise group match
    for (const [group, pattern] of Object.entries(FRANCHISE_PATTERNS)) {
      if (franchiseGroup.toLowerCase().includes(group.toLowerCase())) {
        return website + pattern;
      }
    }
  }

  // Try to detect franchise from the website URL itself
  const websiteLower = website.toLowerCase();
  if (websiteLower.includes('raywhite'))    return website + FRANCHISE_PATTERNS['Ray White'];
  if (websiteLower.includes('harcourts'))   return website + FRANCHISE_PATTERNS['Harcourts'];
  if (websiteLower.includes('barryplant'))  return website + FRANCHISE_PATTERNS['Barry Plant'];
  if (websiteLower.includes('ljhooker'))    return website + FRANCHISE_PATTERNS['LJ Hooker'];
  if (websiteLower.includes('mcgrath'))     return website + FRANCHISE_PATTERNS['McGrath'];
  if (websiteLower.includes('jelliscraig')) return website + FRANCHISE_PATTERNS['Jellis Craig'];

  return website + DEFAULT_SEARCH_PATTERN;
}

// ─── DB Write ─────────────────────────────────────────────────────────────────

/**
 * Upsert a single discovered agency into the Supabase agencies table.
 * Conflicts on (website, suburb) — updates enabled fields in place.
 */
export async function upsertAgency(agency: DiscoveredAgency): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  try {
    const client = getSupabaseServerClient();
    const { error } = await client
      .from('agencies')
      .upsert(
        {
          name: agency.name,
          website: agency.website,
          suburb: agency.suburb ?? null,
          state: agency.state,
          postcode: agency.postcode ?? null,
          franchise_group: agency.franchise_group ?? null,
          search_pattern: agency.search_pattern ?? null,
          suburbs_covered: agency.suburbs_covered ?? [],
          enabled: true,
        },
        { onConflict: 'website,suburb' }
      );

    if (error) {
      console.error(`[upsertAgency] Failed for ${agency.website}: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[upsertAgency] Unexpected error for ${agency.website}: ${msg}`);
    return false;
  }
}

// ─── Conversion: hardcoded list → DiscoveredAgency ───────────────────────────

function hardcodedToDiscovered(): DiscoveredAgency[] {
  return CASEY_CARDINIA_AGENCIES.map((a) => ({
    name: a.name,
    website: a.website,
    suburb: a.suburbs[0], // primary suburb
    state: 'VIC',
    postcode: undefined,
    franchise_group: detectFranchise(a.name),
    search_pattern: a.searchPattern,
    suburbs_covered: a.suburbs,
  }));
}

function detectFranchise(name: string): string | undefined {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('ray white'))      return 'Ray White';
  if (nameLower.includes('harcourts'))      return 'Harcourts';
  if (nameLower.includes('barry plant'))    return 'Barry Plant';
  if (nameLower.includes('lj hooker'))      return 'LJ Hooker';
  if (nameLower.includes('mcgrath'))        return 'McGrath';
  if (nameLower.includes('jellis craig'))   return 'Jellis Craig';
  if (nameLower.includes('belle property')) return 'Belle Property';
  if (nameLower.includes('first national')) return 'First National';
  if (nameLower.includes('raine & horne'))  return 'Raine & Horne';
  if (nameLower.includes('fletchers'))      return 'Fletchers';
  if (nameLower.includes('stockdale'))      return 'Stockdale & Leggo';
  if (nameLower.includes("o'brien"))        return "O'Brien Real Estate";
  if (nameLower.includes('one agency'))     return 'One Agency';
  return undefined;
}

// ─── Main Orchestration ───────────────────────────────────────────────────────

/**
 * Run the full agency discovery pipeline:
 * 1. Scrape franchise pages + REIV directory (in parallel)
 * 2. Merge + deduplicate with existing hardcoded agencies
 * 3. Infer search patterns
 * 4. Save all to Supabase
 */
export async function runAgencyDiscovery(): Promise<void> {
  console.log('[discover-agencies] Starting agency discovery...');

  // 1. Discover from external sources in parallel
  const [franchiseAgencies, reivAgencies] = await Promise.all([
    discoverFromFranchisePages(),
    discoverFromReivDirectory(),
  ]);

  // 2. Merge with hardcoded list
  const hardcoded = hardcodedToDiscovered();
  const discovered = [...franchiseAgencies, ...reivAgencies];

  // Deduplicate by website URL (case-insensitive)
  const websiteMap = new Map<string, DiscoveredAgency>();

  // Hardcoded agencies take priority (they have full search patterns + suburbs)
  for (const agency of hardcoded) {
    websiteMap.set(agency.website.toLowerCase(), agency);
  }

  // Discovered agencies fill in gaps (don't overwrite hardcoded)
  for (const agency of discovered) {
    const key = agency.website.toLowerCase();
    if (!websiteMap.has(key)) {
      websiteMap.set(key, agency);
    }
  }

  const merged = [...websiteMap.values()];
  console.log(
    `[discover-agencies] Merged: ${hardcoded.length} hardcoded + ${discovered.length} discovered = ${merged.length} unique agencies`
  );

  // 3. Infer search patterns for any missing
  for (const agency of merged) {
    if (!agency.search_pattern) {
      agency.search_pattern = inferSearchPattern(agency.website, agency.franchise_group);
    }
  }

  // 4. Save to Supabase
  if (!isSupabaseConfigured()) {
    console.warn('[discover-agencies] Supabase not configured — skipping DB save.');
    console.log(`[discover-agencies] Discovered ${merged.length} agencies, saved 0 to database`);
    return;
  }

  let saved = 0;
  for (const agency of merged) {
    const ok = await upsertAgency(agency);
    if (ok) saved++;
  }

  console.log(
    `[discover-agencies] Discovered ${merged.length} agencies, saved ${saved} to database`
  );
}
