// ============================================================
// Domain actor run trigger — shared by the ingest webhook so a blocked/empty
// scheduled run can re-trigger itself.
//
// The Domain actor (fatihtahta/domain-com-au-scraper) manages its own proxies
// internally and exposes NO proxy field, so Domain's anti-bot occasionally
// blocks a run: it exits SUCCEEDED with 0 items ("temporary access issue").
// Blocking is transient — a fresh run almost always lands data — so when the
// ingest webhook sees an empty dataset it re-triggers a new run (bounded by an
// attempt counter carried on a run-level webhook) instead of silently ingesting
// nothing. Keep SUBURB_SLUGS in sync with scripts/ingest-domain-apify.mjs.
// ============================================================

import type { IngestCategory } from './domain-mapper';

const APIFY_BASE = 'https://api.apify.com/v2';
export const DOMAIN_ACTOR_ID = '0EXe0hsmDKWLI3JF9';

// How many fresh runs the webhook will attempt before giving up (and alerting).
export const MAX_RUN_ATTEMPTS = Number(process.env.RUN_MAX_ATTEMPTS) || 4;

// City of Casey + Shire of Cardinia ONLY — slugs are {suburb}-vic-{postcode}.
const SUBURB_SLUGS = [
  // Casey
  'berwick-vic-3806', 'narre-warren-vic-3805', 'narre-warren-south-vic-3805', 'cranbourne-vic-3977',
  'cranbourne-east-vic-3977', 'cranbourne-north-vic-3977', 'cranbourne-west-vic-3977', 'hallam-vic-3803',
  'hampton-park-vic-3976', 'doveton-vic-3177', 'endeavour-hills-vic-3802', 'lynbrook-vic-3975',
  'lyndhurst-vic-3975', 'clyde-vic-3978', 'clyde-north-vic-3978',
  // Cardinia
  'pakenham-vic-3810', 'officer-vic-3809', 'beaconsfield-vic-3807', 'beaconsfield-upper-vic-3808',
  'emerald-vic-3782', 'cockatoo-vic-3781', 'gembrook-vic-3783', 'koo-wee-rup-vic-3981',
  'nar-nar-goon-vic-3812', 'bunyip-vic-3815', 'garfield-vic-3814', 'tynong-vic-3813',
  'cardinia-vic-3978', 'lang-lang-vic-3984',
];

const CATEGORY_RUN: Record<IngestCategory, { saleType: string; urlFor: (slug: string) => string }> = {
  sold: { saleType: 'sold', urlFor: (s) => `https://www.domain.com.au/sold-listings/${s}/` },
  'on-market': { saleType: 'buy', urlFor: (s) => `https://www.domain.com.au/sale/${s}/` },
  rent: { saleType: 'rent', urlFor: (s) => `https://www.domain.com.au/rent/${s}/` },
};

/**
 * Start a fresh Domain actor run for `category`, attaching a run-level webhook
 * that POSTs back to this same ingest endpoint (carrying attempt = current + 1)
 * on SUCCEEDED. Returns the new run id. Throws if Apify rejects the start.
 */
export async function retriggerDomainRun(
  category: IngestCategory,
  origin: string,
  token: string,
  nextAttempt: number,
): Promise<string> {
  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) throw new Error('APIFY_API_TOKEN not set');

  const { saleType, urlFor } = CATEGORY_RUN[category];
  const startUrls = SUBURB_SLUGS.map((slug) => ({ url: urlFor(slug) }));

  // Run-level webhook → back to /api/ingest/domain with the bumped attempt count.
  const requestUrl =
    `${origin}/api/ingest/domain?category=${category}` +
    `&token=${encodeURIComponent(token)}&attempt=${nextAttempt}`;
  const webhooks = Buffer.from(
    JSON.stringify([{ eventTypes: ['ACTOR.RUN.SUCCEEDED'], requestUrl }]),
    'utf8',
  ).toString('base64');

  const res = await fetch(
    `${APIFY_BASE}/acts/${DOMAIN_ACTOR_ID}/runs?token=${apifyToken}&webhooks=${webhooks}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `saleType` MUST be set and the 'any' defaults supplied, or the actor
      // returns 0 items. Caps with `limit`, NOT `maxItems`. Bills $1/1k records.
      body: JSON.stringify({
        startUrls,
        saleType,
        bedrooms: 'any', bathrooms: 'any', parking: 'any',
        propertySizeMin: 'any', propertySizeMax: 'any', newEstablished: 'any',
        excludeUnderOffer: false, enrich_data: false, get_agents: false,
        limit: Number(process.env.LIMIT) || 1500,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`re-trigger HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}
