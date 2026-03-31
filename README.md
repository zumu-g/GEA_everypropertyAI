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
# Required — Firecrawl for web scraping
FIRECRAWL_API_KEY=your-key          # Get at https://firecrawl.dev

# LLM Extraction — pick ONE (OpenRouter recommended for cost)
OPENROUTER_API_KEY=your-key         # Get at https://openrouter.ai/keys
OPENROUTER_MODEL=moonshotai/kimi-k2 # See model options below
# OR
ANTHROPIC_API_KEY=your-key          # Direct Anthropic (more expensive)

# Optional
NEXT_PUBLIC_SUPABASE_URL=           # Supabase for persistent storage
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=    # Google Places autocomplete (has free fallback)
CRON_SECRET=                        # Auth token for daily cron endpoint
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
| realestate.com.au | **Active** | Listings, photos, features, prices, sale history |
| domain.com.au | **Active** | Listings, photos, suburb data |
| oldlistings.com.au (buy) | **Active** | 18 years historical listing prices, 15M+ records |
| oldlistings.com.au (rent) | **Active** | 18 years historical rental listings |
| homely.com.au | **Active** | Property-specific sold data (property URL, suburb fallback) |
| homehound.com.au | **Active** | Listings via Renet CRM |
| view.com.au | Disabled | Datadome captcha |
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
| GET | `/api/address-suggest?q=...&state=...&lat=...&lng=...` | Address autocomplete (location-aware) |
| POST | `/api/property` | Full property lookup pipeline |
| GET | `/api/property/[id]` | Cached property by slug |
| GET | `/api/enrich?address=...&suburb=...&state=...&postcode=...` | Planning, schools, transport, market data |
| POST | `/api/cron/daily-listings` | Trigger daily listing crawl |
| GET | `/api/cron/daily-listings` | Check cron status |

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

## Tech Stack

- **Framework:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4
- **Scraping:** Firecrawl SDK
- **LLM:** OpenRouter (Kimi K2 default) or Anthropic Claude
- **Database:** In-memory cache (Supabase-ready)
- **Maps:** Nominatim (free), Google Places (optional)
- **Planning:** VicPlan ArcGIS REST API
- **Market Data:** CoreLogic via YourInvestmentPropertyMag
- **Deployment:** Vercel
