import { describe, it, expect } from 'vitest';
import { run, CATEGORY } from './send-listing-reports.mjs';

const NOW = '2026-11-24T01:47:00.000Z';
const ago = (d) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const env = { NEXT_PUBLIC_SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'rk', REPORT_TO: 'me@example.com' };
const listing = (o) => ({ id: 1, address_slug: 'a', raw_address: '1 A St, Berwick VIC 3806', suburb: 'Berwick', source: 'domain-web-unlocker', active: true,
  lifecycle_status: 'active', listed_date: null, campaign_started_at: ago(55.3), created_at: ago(55.3), last_seen_at: NOW, removed_at: null, close_reason: null, ...o });

function fake({ watermark, resendStatus = 200, recordStatus = 201 } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname.split('/').pop(), q: decodeURIComponent(u.search), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (u.host === 'api.resend.com') return new Response(JSON.stringify({ id: 'e1' }), { status: resendStatus });
    const table = u.pathname.split('/').pop();
    if (init.method === 'POST') return new Response(null, { status: recordStatus });
    if (table === 'feed_runs' && u.search.includes('category=eq.listing-reports')) return Response.json(watermark ? [{ run_start: watermark }] : []);
    if (table === 'feed_runs') return Response.json([{ source: 'homely', status: 'blocked' }]);
    if (table === 'property_listings' && u.search.includes('active=eq.true')) return Response.json(u.search.includes('offset=0') ? [listing({})] : []);
    if (table === 'property_listings') return Response.json(u.search.includes('offset=0') || !u.search.includes('offset=') ? [listing({ id: 2, address_slug: 'w', raw_address: '5 W St, Officer VIC 3809', suburb: 'Officer', active: false, lifecycle_status: 'withdrawn', close_reason: 'sweep', removed_at: ago(0.2) })] : []);
    return Response.json([]);
  };
  return { fetch, calls };
}
const printPdf = async () => Buffer.from('%PDF');

describe('send-listing-reports run', () => {
  it('uses the stored watermark, emails both reports with four attachments, then records the run', async () => {
    const f = fake({ watermark: ago(1) });
    const out = await run({ fetch: f.fetch, env, now: NOW, printPdf });
    expect(out).toMatchObject({ new55: 1, withdrawn: 1, since: ago(1) });
    const send = f.calls.find((c) => c.host === 'api.resend.com');
    expect(send.body.to).toEqual(['me@example.com']);
    expect(send.body.attachments.map((a) => a.filename)).toEqual(['55-day-2026-11-24.pdf', '55-day-2026-11-24.html', 'withdrawn-2026-11-24.pdf', 'withdrawn-2026-11-24.html']);
    expect(send.body.html).toContain('homely');
    const idxSend = f.calls.indexOf(send);
    const rec = f.calls.findIndex((c) => c.method === 'POST' && c.path === 'feed_runs');
    expect(rec).toBeGreaterThan(idxSend);
    expect(f.calls[rec].body).toMatchObject({ category: CATEGORY, status: 'ok', run_start: NOW });
    expect(f.calls.find((c) => c.path === 'property_listings' && !c.q.includes('active=eq.true')).q).toContain(`removed_at=gt.${ago(1)}`);
  });

  it('encodes a +00:00 watermark so the + survives the URL', async () => {
    const f = fake({ watermark: '2026-11-23T01:47:00.123+00:00' });
    const seen = [];
    const spy = async (url, init) => { seen.push(url); return f.fetch(url, init); };
    await run({ fetch: spy, env, now: NOW, printPdf });
    expect(seen.find((u) => u.includes('removed_at=gt.'))).toContain('removed_at=gt.2026-11-23T01%3A47%3A00.123%2B00%3A00');
  });

  it('fails loudly when the watermark write fails after the email went out', async () => {
    await expect(run({ fetch: fake({ recordStatus: 500 }).fetch, env, now: NOW, printPdf })).rejects.toThrow(/watermark/i);
  });

  it('defaults to the last 24 hours when there is no watermark', async () => {
    expect((await run({ fetch: fake().fetch, env, now: NOW, printPdf })).since).toBe(ago(1));
  });

  it('records no run when the email fails, so the next run catches up', async () => {
    const f = fake({ resendStatus: 500 });
    await expect(run({ fetch: f.fetch, env, now: NOW, printPdf })).rejects.toThrow(/resend/i);
    expect(f.calls.some((c) => c.method === 'POST' && c.path === 'feed_runs')).toBe(false);
  });

  it('dry run sends and records nothing', async () => {
    const f = fake();
    await run({ fetch: f.fetch, env, now: NOW, printPdf, dryRun: true, outDir: null });
    expect(f.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
