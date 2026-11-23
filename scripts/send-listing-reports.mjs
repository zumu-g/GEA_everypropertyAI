#!/usr/bin/env node
// ============================================================
// Daily 55-day and withdrawn listing reports → one email to Stuart.
// Reads listings since the last successful run (feed_runs watermark), renders two
// A4 HTML reports, prints them to PDF with Chrome, and emails the PDFs + HTML via
// Resend. The run is recorded only after the email is accepted, so a failed day is
// caught up next run. Plan: docs/plans/2026-11-23-1311-feat-daily-55day-withdrawn-reports-plan.html
//
// Usage: node scripts/send-listing-reports.mjs [--dry-run]   (dry run writes ./out, sends nothing)
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REPORT_TO,
//      REPORT_FROM (default Resend sandbox sender), CHROME_PATH (optional), HEALTHCHECK_UUID (optional)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { client, inChunks, recordRun } from './lib/feed-write.mjs';
import { DAYS, domBasis, dedupeBySlug, select55Day, selectWithdrawn, priceCutSummary, groupBySuburb } from './lib/listing-reports.mjs';
import { renderReport } from './lib/listing-report-render.mjs';
import { pingStart, pingSuccess, pingFail } from './lib/healthcheck.mjs';

export const CATEGORY = 'listing-reports';
const DAY_MS = 86_400_000;
const enc = encodeURIComponent; // Postgres returns +00:00 offsets; a bare + decodes to a space
const COLS = 'id,address_slug,raw_address,suburb,source,active,lifecycle_status,close_reason,listed_date,campaign_started_at,created_at,last_seen_at,removed_at,'
  + 'bedrooms,bathrooms,car_spaces,property_type,display_price,agency_name,agent_name,listing_url';
const MEL = 'Australia/Melbourne';
const isoDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: MEL });
const auDate = (iso) => new Date(iso).toLocaleDateString('en-AU', { timeZone: MEL, day: '2-digit', month: '2-digit', year: 'numeric' });

/** Print an HTML string to an A4 PDF with headless Chrome. */
export async function chromePdf(html, env = process.env) {
  const dir = mkdtempSync(join(tmpdir(), 'epai-report-'));
  try {
    writeFileSync(join(dir, 'r.html'), html);
    const chrome = env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
    execFileSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--print-to-pdf=${join(dir, 'r.pdf')}`, pathToFileURL(join(dir, 'r.html')).href],
      { stdio: 'ignore', timeout: 120_000 });
    return readFileSync(join(dir, 'r.pdf'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function sendEmail(fetch, env, { subject, html, attachments }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.REPORT_FROM || 'everypropertyAI <onboarding@resend.dev>', to: [env.REPORT_TO], subject, html,
      attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`[listing-reports] Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * @param {{ fetch?: typeof fetch, env?: object, now?: string, printPdf?: (html:string)=>Promise<Buffer>, dryRun?: boolean, outDir?: string|null }} p
 */
export async function run({ fetch = globalThis.fetch, env = process.env, now = new Date().toISOString(), printPdf = (h) => chromePdf(h, env), dryRun = false, outDir = 'out' } = {}) {
  const db = client({ fetch, env });
  const [last] = await db.get(`feed_runs?select=run_start&category=eq.${CATEGORY}&status=eq.ok&order=run_start.desc&limit=1`);
  const since = last?.run_start ?? new Date(Date.parse(now) - DAY_MS).toISOString();

  const [active, closed, feedRuns] = await Promise.all([
    db.getAll(`property_listings?select=${COLS}&active=eq.true`),
    db.getAll(`property_listings?select=${COLS}&active=eq.false&removed_at=gt.${enc(since)}&removed_at=lte.${enc(now)}`),
    db.get(`feed_runs?select=source,status&category=eq.on-market&status=neq.ok&run_start=gte.${enc(new Date(Date.parse(now) - 18 * 3600_000).toISOString())}`),
  ]);
  const rows55 = select55Day(active, since, now);
  const withdrawn = selectWithdrawn([...active, ...closed], since, now);
  const total55 = dedupeBySlug(active).filter((r) => Date.parse(domBasis(r).date) + DAYS * DAY_MS <= Date.parse(now)).length;
  const feedIssues = [...new Set(feedRuns.map((r) => `${r.source} (${r.status})`))];

  // Price cuts for the listed rows only.
  const picked = [...rows55, ...withdrawn.rows];
  const history = new Map();
  for (const f of inChunks([...new Set(picked.map((r) => r.raw_address))])) {
    for (const h of await db.get(`listing_price_history?select=raw_address,observed_at,price_low,price_high&table_name=eq.listings&raw_address=${f}`)) {
      (history.get(h.raw_address) ?? history.set(h.raw_address, []).get(h.raw_address)).push(h);
    }
  }
  const withCut = (rs) => rs.map((r) => ({ ...r, cut: priceCutSummary(history.get(r.raw_address) ?? []) }));

  const date = auDate(now), stamp = isoDate(now);
  const meta = { date, total55, feedIssues, staleCount: withdrawn.staleCount };
  const html55 = renderReport('55day', groupBySuburb(withCut(rows55)), meta);
  const htmlW = renderReport('withdrawn', groupBySuburb(withCut(withdrawn.rows)), meta);
  const out = { since, new55: rows55.length, withdrawn: withdrawn.rows.length, staleCount: withdrawn.staleCount, total55, feedIssues };
  console.log(`[listing-reports] since=${since} new55=${out.new55} total55=${total55} withdrawn=${out.withdrawn} stale=${out.staleCount} issues=${feedIssues.join(',') || 'none'}`);

  const files = [
    { filename: `55-day-${stamp}.pdf`, content: await printPdf(html55) }, { filename: `55-day-${stamp}.html`, content: html55 },
    { filename: `withdrawn-${stamp}.pdf`, content: await printPdf(htmlW) }, { filename: `withdrawn-${stamp}.html`, content: htmlW },
  ];
  if (dryRun) {
    if (outDir) { mkdirSync(outDir, { recursive: true }); for (const f of files) writeFileSync(join(outDir, f.filename), f.content); }
    return out;
  }
  const note = `<p>Good afternoon Stuart,</p><p>Today's listing reports for Casey and Cardinia are attached.</p><ul>`
    + `<li>55 days, not sold: <b>${out.new55}</b> new (${total55} active at 55+ days)</li><li>Withdrawn: <b>${out.withdrawn}</b></li></ul>`
    + (feedIssues.length ? `<p>Feed problem this morning: ${feedIssues.join(', ')}. The reports may be incomplete.</p>` : '')
    + (out.new55 + out.withdrawn === 0 ? '<p>None today.</p>' : '');
  await sendEmail(fetch, env, { subject: `Listing reports ${date}: ${out.new55} at 55 days, ${out.withdrawn} withdrawn`, html: note, attachments: files });
  // recordRun never throws; a lost watermark would re-send these rows tomorrow, so fail the job instead.
  if (!await recordRun({ category: CATEGORY, source: 'listing-reports', run_start: now, status: 'ok', seen: out.new55 + out.withdrawn, closed: 0, notes: out }, { fetch, env })) {
    throw new Error('[listing-reports] email sent but the watermark write failed; tomorrow repeats these rows');
  }
  return out;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env.local in CI */ }
  const uuid = process.env.HEALTHCHECK_UUID;
  await pingStart(uuid);
  try {
    const out = await run({ dryRun: process.argv.includes('--dry-run') });
    await pingSuccess(uuid, `new55=${out.new55} withdrawn=${out.withdrawn}`);
  } catch (e) {
    console.error(e);
    await pingFail(uuid, `BROKEN ${e?.message || e}`);
    process.exit(1);
  }
}
