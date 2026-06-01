# PropertyIQ

Comprehensive Australian property data platform — aggregates data from 8+ portals, 43 agency websites, planning/zoning databases, and CoreLogic market data into a single search.

## Quick Start

```bash
npm install
cp .env.local.example .env.local
# Add your API keys to .env.local (see Configuration below)
npm run dev
# Open http://localhost:3002
```

## Configuration (.env.local)

```bash
# Required — Firecrawl for web scraping (unprotected sources)
FIRECRAWL_API_KEY=your-key          # Get at https://firecrawl.dev

# Scraping cascade for bot-protected portals (REA/Domain/View) — see "Scraping Backends"
APIFY_API_TOKEN=your-token          # PRIMARY for protected portals. https://console.apify.com/account/integrations
STEALTH_SCRAPER_URL=                # FALLBACK — URL of the services/scraper stealth browser (e.g. http://localhost:8090)
STEALTH_SCRAPER_SECRET=             # Optional bearer for the stealth service
STEALTH_ENGINE=camoufox             # camoufox (default) | patchright | playwright

# LLM Extraction — pick ONE (OpenRouter recommended for cost)
EXTRACTION_PROVIDER=llm             # 'llm' (default) or 'firecrawl' (native /extract)
OPENROUTER_API_KEY=your-key         # Get at https://openrouter.ai/keys
OPENROUTER_MODEL=moonshotai/kimi-k2 # See model options below
# OR
ANTHROPIC_API_KEY=your-key          # Direct Anthropic (more expensive)

# Optional
NEXT_PUBLIC_SUPABASE_URL=           # Supabase for persistent storage (property_cache, property_sales, …)
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MAPBOX_ACCESS_TOKEN=                # Mapbox autocomplete/geocoding (preferred)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=    # Google Places autocomplete (fallback)
CRON_SECRET=                        # Auth token for cron endpoints
```

### OpenRouter Model Options

| Model | Cost/M tokens | Notes |
|---|---|---|
| `moonshotai/kimi-k2` | ~$0.60 | Default — good at structured extraction |
| `deepseek/deepseek-chat-v3-0324` | ~$0.27 | Cheapest good option |
| `google/gemini-2.5-flash` | ~$0.15 | Fastest + cheapest |
| `meta-llama/llama-4-maverick` | ~$0.50 | Open source |
| `anthropic/claude-sonnet-4` | ~$3.00 | Best quality |

Without any LLM key, the app falls back to regex-based extraction (gets beds/baths/cars/features but misses sale history and descriptions).

## Scraping Backends (cascade)

Bot-protected portals are fetched through a per-source fallback cascade in
`src/lib/firecrawl/orchestrator.ts`:

1. **Apify** (`APIFY_API_TOKEN`) — PRIMARY for REA/Domain/View. Managed actors with residential
   proxies that bypass Kasada (REA) / DataDome (View) / Cloudflare (Domain).
   - REA → `azzouzana/real-estate-au-scraper-pro`
   - Domain → `shahidirfan/Domain-com-au-Property-Scraper`
   - View → `abotapi/view-com-au-scraper` (runs in `mode: url` via `apifyInput`)
2. **Stealth browser** (`STEALTH_SCRAPER_URL`) — FALLBACK. The `services/scraper` Fastify service
   (Camoufox / Patchright / Playwright). Handles SPA settle + anti-detect fingerprinting.
3. **Firecrawl** — primary for unprotected sources (oldlistings, homely, homehound, agencies).

If `APIFY_API_TOKEN` and `STEALTH_SCRAPER_URL` are both unset, protected portals fall through to
raw Firecrawl and get rate-limited (429) — so set at least one. Notes: REA uses **Kasada**, which
plain playwright-stealth cannot beat (needs Apify or Camoufox); the cascade drops Firecrawl from
the protected-portal chain to avoid wasted 15–30s timeouts.

## Architecture

```
propertyiq/
├── src/
│   ├── app/
│   │   ├── page.tsx                         # Landing page with address search
│   │   ├── property/page.tsx                # Property profile page
│   │   └── api/
│   │       ├── address-suggest/route.ts     # REA autocomplete proxy
│   │       ├── property/route.ts            # Crawl → extract → merge pipeline
│   │       ├── enrich/route.ts              # Planning, schools, transport, market data
│   │       └── cron/daily-listings/route.ts # Daily listing crawler
│   ├── lib/
│   │   ├── firecrawl/
│   │   │   ├── orchestrator.ts              # Parallel multi-source crawling
│   │   │   ├── client.ts                    # Firecrawl SDK wrapper
│   │   │   └── sources/                     # 8 portal configs + 43 agency configs
│   │   ├── extraction/
│   │   │   ├── extractor.ts                 # OpenRouter/Anthropic LLM + regex fallback
│   │   │   ├── merger.ts                    # Multi-source data merger with confidence
│   │   │   ├── schemas.ts                   # Zod validation schemas
│   │   │   └── prompts.ts                   # LLM extraction prompts (target-address aware)
│   │   ├── estimation/
│   │   │   └── price-estimator.ts           # Growth-adjusted price estimation with confidence
│   │   ├── enrichment/
│   │   │   ├── planning.ts                  # VicPlan zoning/overlays (ArcGIS)
│   │   │   ├── schools.ts                   # Nearby schools (Nominatim)
│   │   │   ├── transport.ts                 # Train/tram stations (Nominatim)
│   │   │   ├── market-data.ts               # CoreLogic suburb data (YIPM)
│   │   │   ├── buyer-demand.ts              # Demand indicator (Domain)
│   │   │   ├── geocoding.ts                 # Address → lat/lng (Nominatim)
│   │   │   └── suburb-stats.ts              # Suburb stats (REA)
│   │   ├── jobs/
│   │   │   └── daily-listings.ts            # Daily sold/buy listing crawler
│   │   └── address-suggest.ts               # REA autocomplete library
│   ├── components/
│   │   ├── search/AddressSearch.tsx          # Autocomplete with geolocation
│   │   └── property/PropertyProfile.tsx     # Full property profile view
│   └── types/
│       ├── property.ts                      # Property type definitions
│       ├── crawl.ts                         # Crawl types + SourceConfig
│       └── source.ts                        # Data source names
│   ├── lib/apify/client.ts                  # Apify actor wrapper (protected portals)
│   └── lib/stealth/client.ts                # Stealth-service HTTP client
├── services/
│   ├── scraper/                             # Stealth browser service (Camoufox/Patchright/Playwright)
│   └── everypropertyai/                     # MCP server + CLI exposing data to CMA/proposal tools
├── DESIGN.md                                # Design system (cool data-site look; overrides GEA baseline)
├── vercel.json                              # Cron config (daily at 6am)
└── .env.local                               # API keys (not committed)
```

## Price Estimation

Two-phase estimation with growth adjustment and confidence scoring:

**Phase 1 (instant):** Quick estimate from merged extraction data at page load.

**Phase 2 (after enrichment):** Growth-adjusted estimate using suburb market data from CoreLogic.

### Priority Cascade

| Priority | Condition | Method | Band | Confidence |
|---|---|---|---|---|
| 1 | Active listing with price range | Use listing guide directly | ±3% | High |
| 2 | Active listing with single price | Use listing price | ±3% | High |
| 3 | Sale <6 months ago | Growth-adjust using suburb annual growth | ±8% | High |
| 4 | Sale 6-24 months ago | Growth-adjust | ±12% | Medium |
| 5 | Sale 2-5 years ago | Growth-adjust | ±18% | Medium |
| 6 | Sale 5+ years ago | Growth-adjust, capped at 3x | ±25% | Low |
| 7 | Rental history only | Rental yield implied value | ±20% | Low |
| 8 | No history | Suburb median ± bedroom/land adjustment | ±20% | Low |

Growth formula: `adjustedPrice = salePrice × (1 + annualGrowth/100)^years`

Cross-validated against rental yield where available. Confidence badge (high/medium/low) and methodology explanation shown in UI.

## Data Quality

### Target-Address Filtering

The LLM extraction prompt includes the target property address and instructs the model to extract data ONLY for that specific property. This prevents data pollution from multi-property pages (e.g., suburb sold listings). Post-extraction address validation provides a second layer of protection.

### Sale History

Each sale record includes: date, price, sale type, agency, agent name, days on market, listing price, settlement date, and source portal. Records are deduplicated across sources by date+price, with richer fields merged from duplicates.

### Rental History

Rental records include: date, weekly rent, bond, agency, agent/manager, days on market, and lease term. Oldlistings provides both buy and rent history via separate URL endpoints.

## Data Sources

### Portal Sources

| Source | Status | Data |
|---|---|---|
| realestate.com.au | **Active** (Apify) | Listings, photos, features, prices, sale history. Kasada-protected → Apify actor |
| domain.com.au | **Active** (Apify) | Listings, photos, suburb data. Verified returning structured data |
| view.com.au | **Active** (Apify, url mode) | DataDome — via Apify actor; single-property hits depend on slug/listing availability |
| oldlistings.com.au (buy) | **Active** | 18 years historical listing prices, 15M+ records |
| oldlistings.com.au (rent) | **Active** | 18 years historical rental listings |
| homely.com.au | **Active** | Property-specific sold data (property URL, suburb fallback) |
| homehound.com.au | **Active** | Listings via Renet CRM |
| ratemyagent.com.au | Disabled | DataDome captcha |
| inspectrealestate.com.au | Disabled | B2B SaaS, not a portal |

### Enrichment Sources

| Source | Data | Coverage |
|---|---|---|
| VicPlan (spatial.planning.vic.gov.au) | Zoning, overlays, council | VIC only |
| Nominatim (OpenStreetMap) | Schools, transport, geocoding | Australia-wide |
| YourInvestmentPropertyMag (CoreLogic) | Median prices, growth, yields, demographics | Australia-wide |
| Domain suburb profiles | Buyer demand indicators | Australia-wide |

### Agency Websites (43)

Casey, Cardinia, and Baw Baw council areas. Includes Ray White, Barry Plant, Harcourts, O'Brien, LJ Hooker, Stockdale & Leggo, Raine & Horne, and 20+ independent agencies. Auto-filtered by suburb.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/search?q=...` | Address autocomplete (Mapbox/Google) |
| GET | `/api/address-suggest?q=...&state=...&lat=...&lng=...` | REA autocomplete (clean suburb/state/postcode) |
| POST | `/api/property` | Full property lookup pipeline (`maxDuration` 120s) |
| GET | `/api/property/[slug]/override` | User overrides for a cached property |
| GET | `/api/comparable-sales?suburb=...&state=...&beds=...&baths=...` | Top comparable sales (similarity-scored) |
| GET | `/api/sold-sales?suburb=...&state=...&limit=...` | Recent sold-sales feed (Valuer General) |
| GET | `/api/street-details?q=...` | All known addresses on a street |
| GET | `/api/enrich?address=...&suburb=...&state=...&postcode=...` | Planning, schools, transport, market data |
| POST | `/api/cron/{process-queue,backfill,ingest-vg,daily-listings}` | Cron jobs (`CRON_SECRET` auth) |

These routes are wrapped by `services/everypropertyai` for the CMA/proposal tools.

## Daily Cron

Configured via `vercel.json` to run at 6am daily. Crawls sold + buy listings from REA, Domain, and view.com.au for 8 default VIC suburbs (Berwick, Officer, Pakenham, Cranbourne, Narre Warren, Clyde, Clyde North, Beaconsfield).

Customise via POST body:
```json
{
  "suburbs": [{"name": "Richmond", "state": "VIC", "postcode": "3121"}],
  "types": ["buy", "sold", "rent"],
  "maxPerSuburb": 20
}
```

## everypropertyAI (data access for CMA / proposal tools)

`services/everypropertyai/` is a standalone **MCP server + CLI** that exposes this app's data to
GEA's CMA and proposal tools, wrapping the HTTP API (no logic/keys duplicated).

```bash
cd services/everypropertyai && npm install && npm run build && npm link   # one-time
everypropertyai cma "9 Gloucester Ave Berwick"        # CMA pack (subject + comps + estimate + suburb stats)
everypropertyai proposal "<address>"                   # presentation-ready fields
npm run mcp                                            # MCP stdio server (8 tools)
```

- Config: `EVERYPROPERTY_API_URL` (default `http://localhost:3007`), optional `EVERYPROPERTY_API_TOKEN`.
- 8 MCP tools: `search_address`, `fetch_property`, `comparable_sales`, `sold_sales`, `enrich`,
  `street_details`, `generate_cma_pack`, `proposal_property_data`.
- CMA-project integration prompt: `services/everypropertyai/CMA_INTEGRATION_PROMPT.md`.
- See `services/everypropertyai/README.md` for the full surface.

## Design system

UI follows `DESIGN.md` — a cooler/whiter, sans-dominant "data site" aesthetic (intentional
override of the warm GEA editorial baseline; gold kept as a sparing accent). `DESIGN.stitch.md`
is a Google Stitch–formatted companion. Validate tokens/contrast with `design.md lint DESIGN.md`.

## Current status (resume here)

- ✅ **Redesign** shipped (cool data-site palette, sans headings, shared `src/components/ui` primitives).
- ✅ **Scraping cascade live**: Apify primary (Domain verified returning data), stealth fallback
  (`services/scraper`, playwright engine), Firecrawl for unprotected. **View** runs in url mode
  but single-property hits depend on slug/listing availability.
- ✅ **everypropertyAI** package built, verified (CLI + MCP), `npm link`ed locally.
- 🔜 **Open items:** REA reliability (Kasada — Apify actor / fetch **Camoufox**, blocked earlier by
  a GitHub API rate-limit); `cachedOnly`/`fresh` flag on `/api/property` so CMA packs skip the
  ~120s live crawl; shared-secret auth on data routes before exposing a deployed instance; deploy
  the stealth service + set `STEALTH_SCRAPER_URL` in prod. Branch: `redesign/data-site-look` (unpushed).

## Tech Stack

- **Framework:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4
- **Scraping cascade:** Apify actors (protected portals) → stealth browser (`services/scraper`) → Firecrawl
- **LLM:** OpenRouter (Kimi K2 default), Anthropic Claude, or MiniMax
- **Database:** Supabase (`property_cache`, `property_sales`, …) + in-memory cache
- **Maps:** Mapbox (preferred), Nominatim (free), Google Places (optional)
- **Planning:** VicPlan ArcGIS REST API
- **Market Data:** CoreLogic via YourInvestmentPropertyMag
- **Data access:** `services/everypropertyai` MCP server + CLI
- **Deployment:** Vercel
