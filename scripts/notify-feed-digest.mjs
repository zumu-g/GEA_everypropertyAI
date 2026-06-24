#!/usr/bin/env node
// ============================================================
// Daily data-feed digest → Telegram.
//
// Reads the feed_health table (the source of truth every scheduled feed writes to)
// and sends ONE Telegram message summarising the morning's runs:
//
//   ✅ PropertyIQ feeds OK — 24 Jun
//   • sold        463  domain-web-unlocker   2.2h ago
//   • on-market   611  homely                1.9h ago
//
// Flips to ⚠️ and lists the offenders if any feed is blocked/broken, stale (didn't
// run within the freshness window), or missing entirely. Designed to run a little
// after the last feed finishes (see .github/workflows/daily-feed-digest.yml).
//
// This is the POSITIVE daily confirmation; Healthchecks.io stays as the
// dead-man's-switch backstop ([[wu-feeds-concurrency-fix]] / scripts/lib/healthcheck.mjs).
//
// Usage:
//   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=123 node scripts/notify-feed-digest.mjs
//   node scripts/notify-feed-digest.mjs --dry-run     # print the message, do not send
//
// Env (read from .env.local when present, like the other scripts):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID                  (required unless --dry-run)
//   EXPECTED_CATEGORIES   default "sold,on-market" — feeds that MUST be fresh or it's ⚠️
//   FRESH_HOURS           default 26 — a feed older than this counts as stale
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const EXPECTED = (process.env.EXPECTED_CATEGORIES || 'sold,on-market').split(',').map(s => s.trim()).filter(Boolean);
const FRESH_HOURS = Number(process.env.FRESH_HOURS) || 26;

const MEL = 'Australia/Melbourne';
const fmtDate = (d) => d.toLocaleDateString('en-AU', { timeZone: MEL, day: 'numeric', month: 'short' });
const ageHours = (iso) => (Date.now() - new Date(iso).getTime()) / 3.6e6;

async function fetchHealth() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/feed_health?select=*&order=last_run_at.desc`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) throw new Error(`feed_health HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Build the digest message + an overall ok flag from the feed_health rows.
export function buildDigest(rows, { expected = EXPECTED, freshHours = FRESH_HOURS, now = Date.now() } = {}) {
  const byCategory = new Map(rows.map(r => [r.category, r]));
  const problems = [];
  const lines = [];

  // Report expected feeds first (in declared order), then any extras present.
  const ordered = [...expected, ...rows.map(r => r.category).filter(c => !expected.includes(c))];
  const seen = new Set();
  for (const cat of ordered) {
    if (seen.has(cat)) continue;
    seen.add(cat);
    const r = byCategory.get(cat);
    if (!r) {
      problems.push(`${cat}: no run recorded`);
      lines.push(`• ${cat.padEnd(11)} — never run`);
      continue;
    }
    const age = (now - new Date(r.last_run_at).getTime()) / 3.6e6;
    const stale = age > freshHours;
    const bad = r.status !== 'ok' || stale;
    const mark = bad ? '⚠️' : '•';
    const note = r.status !== 'ok' ? ` [${r.status}]` : stale ? ` [stale ${age.toFixed(0)}h]` : '';
    lines.push(`${mark} ${String(r.category).padEnd(11)} ${String(r.items ?? 0).padStart(4)}  ${r.source_used || '—'}  ${age.toFixed(1)}h ago${note}`);
    if (expected.includes(cat) && bad) {
      problems.push(`${cat}: ${r.status !== 'ok' ? r.status : `stale (${age.toFixed(0)}h)`}`);
    }
  }

  const ok = problems.length === 0;
  const header = ok
    ? `✅ PropertyIQ feeds OK — ${fmtDate(new Date(now))}`
    : `⚠️ PropertyIQ feeds need attention — ${fmtDate(new Date(now))}`;
  const body = [header, '', ...lines];
  if (!ok) body.push('', `Issues: ${problems.join('; ')}`);
  return { ok, text: body.join('\n') };
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, disable_notification: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
  if (!DRY_RUN && (!TG_TOKEN || !TG_CHAT)) { console.error('Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID'); process.exit(1); }

  let rows;
  try {
    rows = await fetchHealth();
  } catch (e) {
    // Can't read health → that is itself worth alerting on (don't fail silently).
    const text = `⚠️ PropertyIQ feed digest could not read feed_health: ${e.message}`;
    console.error(text);
    if (!DRY_RUN) { try { await sendTelegram(text); } catch (e2) { console.error('Telegram send failed:', e2.message); } }
    process.exit(1);
  }

  const { ok, text } = buildDigest(rows);
  console.log(text);

  if (DRY_RUN) { console.log('\n[dry-run] not sending'); return; }
  await sendTelegram(text);
  console.log(`\nSent to Telegram (chat ${TG_CHAT}).`);
  // Exit non-zero when a feed is unhealthy so the scheduler also flags the day.
  if (!ok) process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
