/**
 * Smoke test for Apify actor connectivity.
 * Run from the propertyiq directory:
 *
 *   APIFY_API_TOKEN=your_token node scripts/test-apify.mjs
 *
 * Uses a well-known Berwick property to test each actor.
 * Prints the first few fields of each result so you can confirm
 * the actor is returning usable data.
 */

const APIFY_BASE = 'https://api.apify.com/v2';

const ACTORS = [
  {
    name: 'realestate.com.au',
    id: 'azzouzana/real-estate-au-scraper-pro',
    url: 'https://www.realestate.com.au/property/5-william-st-berwick-vic-3806',
  },
  {
    name: 'domain.com.au',
    id: 'shahidirfan/domain-com-au-property-scraper',
    url: 'https://www.domain.com.au/property-profile/5-william-street-berwick-vic-3806',
  },
  {
    name: 'view.com.au',
    id: 'abotapi/view-com-au-scraper',
    url: 'https://www.view.com.au/property/vic/berwick-3806/5-william-street/',
  },
];

async function runActor(actorId, url, token) {
  const encoded = encodeURIComponent(actorId);
  const input = { startUrls: [{ url }], maxItems: 2 };

  console.log(`  → Starting actor ${actorId} ...`);
  const runRes = await fetch(
    `${APIFY_BASE}/acts/${encoded}/runs?token=${token}&waitForFinish=90`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000),
    }
  );

  if (!runRes.ok) {
    const body = await runRes.text();
    throw new Error(`Actor run failed (${runRes.status}): ${body.slice(0, 200)}`);
  }

  const { data } = await runRes.json();
  console.log(`  ✓ Run ${data.id} — status: ${data.status}`);

  if (data.status !== 'SUCCEEDED') {
    throw new Error(`Actor did not succeed: ${data.status} — ${data.statusMessage ?? ''}`);
  }

  const dataRes = await fetch(
    `${APIFY_BASE}/datasets/${data.defaultDatasetId}/items?token=${token}&clean=true`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!dataRes.ok) throw new Error(`Dataset fetch failed (${dataRes.status})`);

  return await dataRes.json();
}

function preview(items) {
  if (!Array.isArray(items) || items.length === 0) return '  (no items returned)';
  const item = items[0];
  const PREVIEW_KEYS = ['address', 'price', 'bedrooms', 'bathrooms', 'carSpaces', 'landArea', 'propertyType', 'suburb', 'postcode'];
  return PREVIEW_KEYS
    .filter(k => item[k] !== undefined && item[k] !== null && item[k] !== '')
    .map(k => `  ${k}: ${item[k]}`)
    .join('\n') || `  Keys returned: ${Object.keys(item).slice(0, 10).join(', ')}`;
}

const token = process.env.APIFY_API_TOKEN;
if (!token) {
  console.error('Error: APIFY_API_TOKEN env var not set.');
  console.error('Usage: APIFY_API_TOKEN=your_token node scripts/test-apify.mjs');
  process.exit(1);
}

for (const actor of ACTORS) {
  console.log(`\n── ${actor.name} ──────────────────────`);
  console.log(`  URL: ${actor.url}`);
  try {
    const items = await runActor(actor.id, actor.url, token);
    console.log(`  Items returned: ${items.length}`);
    console.log(preview(items));
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
  }
}

console.log('\n── Done ──────────────────────────────');
