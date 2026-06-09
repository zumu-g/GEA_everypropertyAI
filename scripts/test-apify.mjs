/**
 * Smoke test for Apify actor connectivity.
 * Run from the propertyiq directory:
 *
 *   node scripts/test-apify.mjs
 *
 * Reads APIFY_API_TOKEN from .env.local (or the environment). Uses a well-known
 * Berwick property to test each actor we depend on in production, then prints
 * the first few fields of each result so you can confirm usable data is coming
 * back. Polls each run to a terminal state rather than giving up at a fixed
 * cutoff, so slow actors aren't reported as false failures.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (no dep) — only fills missing process.env keys.
try {
  const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const APIFY_BASE = 'https://api.apify.com/v2';

const BERWICK_VIEW_URL = 'https://www.view.com.au/property/vic/berwick-3806/5-william-street/';

const ACTORS = [
  {
    name: 'realestate.com.au',
    id: 'azzouzana/real-estate-au-scraper-pro',
    url: 'https://www.realestate.com.au/property/5-william-st-berwick-vic-3806',
  },
  {
    // Production ingest uses this Domain actor (0EXe0hsmDKWLI3JF9), not the
    // shahidirfan one — smoke-test the actor we actually rely on. It's a
    // long-running batch actor over the full suburb list, so we only confirm it
    // launches (launchOnly) rather than waiting for it to finish.
    name: 'domain.com.au',
    id: '0EXe0hsmDKWLI3JF9',
    url: 'https://www.domain.com.au/property-profile/5-william-street-berwick-vic-3806',
    launchOnly: true,
  },
  {
    // The view.com.au actor needs mode:"url" + a `urls` field for single-property
    // lookups; the default "location" mode rejects startUrls with an input error.
    name: 'view.com.au',
    id: 'abotapi/view-com-au-scraper',
    url: BERWICK_VIEW_URL,
    input: { mode: 'url', urls: [BERWICK_VIEW_URL], maxItems: 2 },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runActor(actorId, url, token, customInput, launchOnly = false) {
  const encoded = encodeURIComponent(actorId);
  const input = customInput ?? { startUrls: [{ url }], maxItems: 2 };

  console.log(`  → Starting actor ${actorId} ...`);
  const runRes = await fetch(
    `${APIFY_BASE}/acts/${encoded}/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!runRes.ok) {
    const body = await runRes.text();
    throw new Error(`Actor run failed (${runRes.status}): ${body.slice(0, 200)}`);
  }

  let { data } = await runRes.json();

  // Long-running batch actors: confirm the run launched, don't wait for finish.
  if (launchOnly) {
    console.log(`  ✓ Run ${data.id} launched — status: ${data.status} (batch actor, not awaited)`);
    return null;
  }

  // Poll to a terminal state (max ~4 min) so slow actors aren't false failures.
  const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
  const deadline = Date.now() + 240_000;
  while (!TERMINAL.has(data.status) && Date.now() < deadline) {
    await sleep(5_000);
    const poll = await fetch(`${APIFY_BASE}/actor-runs/${data.id}?token=${token}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!poll.ok) break;
    ({ data } = await poll.json());
  }
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
  // Actors return an {error,message,...} object on bad input — surface it plainly.
  if (item && item.error) return `  ⚠ actor error: ${item.message ?? JSON.stringify(item).slice(0, 200)}`;
  const fmt = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
  const PREVIEW_KEYS = ['address', 'price', 'soldPrice', 'soldAt', 'bedrooms', 'bathrooms', 'carSpaces', 'landArea', 'propertyType', 'suburb', 'postcode'];
  return PREVIEW_KEYS
    .filter(k => item[k] !== undefined && item[k] !== null && item[k] !== '')
    .map(k => `  ${k}: ${fmt(item[k])}`)
    .join('\n') || `  Keys returned: ${Object.keys(item).slice(0, 10).join(', ')}`;
}

const token = process.env.APIFY_API_TOKEN;
if (!token) {
  console.error('Error: APIFY_API_TOKEN not set (checked .env.local and environment).');
  process.exit(1);
}

for (const actor of ACTORS) {
  console.log(`\n── ${actor.name} ──────────────────────`);
  console.log(`  URL: ${actor.url}`);
  try {
    const items = await runActor(actor.id, actor.url, token, actor.input, actor.launchOnly);
    if (items === null) continue; // launch-only actor; nothing to preview
    console.log(`  Items returned: ${items.length}`);
    console.log(preview(items));
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
  }
}

console.log('\n── Done ──────────────────────────────');
