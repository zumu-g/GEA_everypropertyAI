# PropertyIQ Stealth Scraper

A standalone browser-scraping service for PropertyIQ. Runs a stealth browser to
fetch bot-protected pages (Kasada, DataDome, Cloudflare) that Firecrawl/Apify
can't reach. Three swappable engines:

- **Camoufox** — anti-detect Firefox (default), C++-level fingerprint spoofing.
- **Patchright** — stealth Chromium that patches the CDP/headless tells.
- **Playwright** — vanilla Playwright Chromium hardened with `playwright-extra` +
  `puppeteer-extra-plugin-stealth`; an independent evasion stack to fall back to
  or A/B against the others.

It is the **third fetch backend** for the PropertyIQ orchestrator, alongside
direct Firecrawl and Apify actors. The main app talks to it over HTTP and fails
soft when it's absent — see `src/lib/stealth/client.ts` in the parent app.

> **Why a separate service?** Camoufox needs a custom ~200 MB Firefox binary and
> a long-running process, and Firefox can't run in Vercel/Lambda-style
> environments (the `/dev/shm` limitation). So this deploys as its own container.

## API

```
GET  /health                       → { ok: true, engine }
POST /scrape                        (Authorization: Bearer $STEALTH_SCRAPER_SECRET)
     body: { url, waitFor?, timeout?, engine?, proxy? }
     → { status: 'success'|'failed'|'timeout', html?, markdown?, finalUrl?, error?, engine? }
```

- `engine`: `"camoufox"` (default), `"patchright"` or `"playwright"`. Overridable per request; default set by `STEALTH_ENGINE`.
- `waitFor`: a number (ms to wait after load) or a CSS selector to wait for.
- `proxy`: `{ server, username?, password? }` — overrides the service default proxy.

## Environment

| Var | Purpose |
|-----|---------|
| `PORT` | Listen port (default 8080) |
| `STEALTH_SCRAPER_SECRET` | Bearer token required on `/scrape` (omit only in local dev) |
| `STEALTH_ENGINE` | Default engine: `camoufox` (default), `patchright` or `playwright` |
| `STEALTH_PROXY_SERVER` / `_USERNAME` / `_PASSWORD` | Residential proxy — **required for Kasada/DataDome** |
| `STEALTH_ALLOWED_HOSTS` | Comma-separated host suffixes allowed (SSRF guard). `*` disables the guard |

## Local dev

```bash
npm install
npx camoufox-js fetch          # one-time: download the Camoufox Firefox binary
npm run dev                    # service on :8080

curl -s -X POST localhost:8080/scrape \
  -H "Authorization: Bearer dev" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}' | jq
```

To test another engine: `STEALTH_ENGINE=patchright npm run dev` or
`STEALTH_ENGINE=playwright npm run dev` (or pass `"engine":"patchright"` /
`"engine":"playwright"` in the body). The Chromium engines (`patchright`,
`playwright`) need no separate browser download — `npx playwright install
chromium` if running outside the Playwright Docker base image.

## Deploy (Railway — current)

Live at `https://propertyiq-scraper-production-43c1.up.railway.app` (service
`propertyiq-scraper` in the GEA_everypropertyAI project). `railway.json` pins the
Dockerfile builder and the `/health` check.

```bash
railway up --detach --service propertyiq-scraper   # from services/scraper/
```

Set on the service: `STEALTH_SCRAPER_SECRET`, `STEALTH_ENGINE`,
`STEALTH_ALLOWED_HOSTS`, and the `STEALTH_PROXY_*` trio. Then point the main app
at it: set `STEALTH_SCRAPER_URL` + the same `STEALTH_SCRAPER_SECRET` on the
PropertyIQ service, and set `fetchBackend: 'stealth'` (or
`fallbackBackends: ['stealth']`) on the sources that need it.

> **Dockerfile gotchas** (each cost a failed build):
> - The Playwright base image tag MUST match the `playwright`/`patchright`
>   version in `package-lock.json` — the bundled Chromium is version-specific.
> - `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` must be scoped to `npm ci` only:
>   camoufox-js honours it too and will skip its own Firefox download if it's a
>   global `ENV`, leaving the camoufox engine non-functional ("version vnull").
> - The Railway CLI's `link`/`status` currently error with `deletedAt on
>   VolumeInstance`; `railway up` still works once the project is linked.

## Deploy (Fly.io — alternative)

```bash
fly launch --no-deploy            # generates fly.toml from the Dockerfile
fly secrets set STEALTH_SCRAPER_SECRET=... \
                STEALTH_PROXY_SERVER=... STEALTH_PROXY_USERNAME=... STEALTH_PROXY_PASSWORD=...
fly deploy
```

## Cost / ops notes

- Residential proxy bandwidth is the main recurring cost. Images/media/fonts are
  blocked on every request to reduce it; the orchestrator's 24h cache avoids
  re-fetching successes.
- A fresh browser is launched per request for fingerprint/IP isolation.
- `camoufox-js` is experimental/unversioned — if it breaks, run with
  `STEALTH_ENGINE=patchright` (no app change needed).
