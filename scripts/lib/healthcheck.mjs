// ============================================================
// Healthchecks.io dead-man's-switch ping helper for the scheduled ingest scripts.
//
// Each feed has a check UUID; the runner pings:
//   - /start            at begin            → pingStart()
//   - /<uuid>           on clean success    → pingSuccess()  (body carries the run summary)
//   - /<uuid>/fail      on failure/blocked  → pingFail()
// Silence past the check's window → Healthchecks alerts (email/Slack).
//
// ALL pings are non-throwing and best-effort: a monitor outage must never fail or
// delay a scrape. Missing UUID → silent no-op (resolves false, never throws).
//
// Base URL defaults to https://hc-ping.com and can be overridden with
// HEALTHCHECK_BASE_URL (e.g. a self-hosted Healthchecks instance).
// ============================================================

const BASE_URL = (process.env.HEALTHCHECK_BASE_URL || 'https://hc-ping.com').replace(/\/+$/, '');
const PING_TIMEOUT_MS = 10_000;

/** Build a ping URL for a check UUID and optional suffix ('start' | 'fail'). */
export function pingUrl(uuid, suffix) {
  if (!uuid) return null;
  const base = `${BASE_URL}/${uuid}`;
  return suffix ? `${base}/${suffix}` : base;
}

/** POST to a ping endpoint. Never throws; resolves true on 2xx, false otherwise. */
async function ping(uuid, suffix, body) {
  const url = pingUrl(uuid, suffix);
  if (!url) return false; // unset UUID → no-op so the scrape still runs
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: body == null ? undefined : String(body).slice(0, 10_000),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false; // monitor down must not break the run
  }
}

/** Signal a run has started (resets the check's timer; catches silent hangs). */
export function pingStart(uuid) {
  return ping(uuid, 'start');
}

/** Signal success. Pass a summary string (e.g. row count) — it shows in the dashboard. */
export function pingSuccess(uuid, body) {
  return ping(uuid, undefined, body);
}

/** Signal failure. Pass an error/summary string for the dashboard + alert. */
export function pingFail(uuid, body) {
  return ping(uuid, 'fail', body);
}
