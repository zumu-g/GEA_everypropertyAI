# Data handover — Domain sold + on-market (for the CMA → everypropertyAI migration)

This is the concrete data and the repeatable method behind the sold + on-market property data the CMA
tool was using. Hand this, plus `DOMAIN_INGESTION_PROMPT.md`, to whoever builds the ingestion into
everypropertyAI.

## Source: Apify Domain.com.au scraper

- **Actor:** `0EXe0hsmDKWLI3JF9` (Domain.com.au web scraper)
- **Run API:** `POST https://api.apify.com/v2/acts/0EXe0hsmDKWLI3JF9/runs?token=$APIFY_API_TOKEN`
- **Token:** `APIFY_API_TOKEN` — present in the CMA repo's `.env` (and in this repo's `.env.local`).
- **Input:** `{ "startUrls": [ ...one URL per suburb... ], "maxItems": 5000 }`
- **Start URL patterns** (per suburb slug `{suburb}-vic-{postcode}`):
  - **Sold:** `https://www.domain.com.au/sold-listings/{suburb}-vic-{postcode}/`
  - **On-market (for sale):** `https://www.domain.com.au/sale/{suburb}-vic-{postcode}/`
- **Orchestration:** start run → poll `GET /v2/actor-runs/{runId}` until `status=SUCCEEDED` →
  read items from `GET /v2/datasets/{defaultDatasetId}/items?clean=true` (paginate with
  `offset`/`limit`; datasets can hold tens of thousands of items).

The original orchestration lives in the CMA repo at `scripts/sync-data.sh` (reference only — the
clean re-implementation belongs in everypropertyAI).

## Existing datasets (already scraped — reusable now)

Datasets persist on Apify and are re-readable, but expire over time. Re-run the actor for fresh data.

| Category   | Dataset ID            | ~Items | Status   |
|------------|-----------------------|--------|----------|
| Sold       | `HVziEJ6qGYiszKsTl`   | ~28,000 | SUCCEEDED |
| On-market  | `V56AzVH6c9Bf2XNUN`   | 1,391   | SUCCEEDED |

Read items: `GET https://api.apify.com/v2/datasets/<datasetId>/items?token=$APIFY_API_TOKEN&clean=true&offset=0&limit=1000`

## Suburb list (Casey / Cardinia / Bass Coast / West Gippsland)

```
berwick-vic-3806 narre-warren-vic-3805 narre-warren-south-vic-3805 cranbourne-vic-3977
cranbourne-east-vic-3977 cranbourne-north-vic-3977 cranbourne-west-vic-3977 hallam-vic-3803
hampton-park-vic-3976 doveton-vic-3177 endeavour-hills-vic-3802 lynbrook-vic-3975
lyndhurst-vic-3975 clyde-vic-3978 clyde-north-vic-3978 pakenham-vic-3810 officer-vic-3809
beaconsfield-vic-3807 beaconsfield-upper-vic-3808 emerald-vic-3782 cockatoo-vic-3781
gembrook-vic-3783 koo-wee-rup-vic-3981 nar-nar-goon-vic-3812 bunyip-vic-3815 garfield-vic-3814
tynong-vic-3813 cardinia-vic-3978 nyora-vic-3987 lang-lang-vic-3984 loch-vic-3945
poowong-vic-3988 korumburra-vic-3950 drouin-vic-3818 warragul-vic-3820 longwarry-vic-3816
```

## Item schema (both sold and on-market)

```jsonc
{
  "record_type": "listing",
  "location": {
    "display_address": "16 Solid Drive, Pakenham VIC 3810",
    "suburb": "Pakenham", "state": "VIC", "postcode": "3810",
    "latitude": -38.05584, "longitude": 145.47925          // coords present on every record
  },
  "pricing": {
    "display_price": "$245,000"                            // SOLD: single $ amount
    // "display_price": "$930,000 - $970,000"              // ON-MARKET: a RANGE, or marketing text
  },
  "listing": {
    "tags": { "tag_text": "Sold by private treaty 07 Oct 2020" }  // SOLD: contains the sale date
    // "tags": { "tag_text": "Under offer" }                       // ON-MARKET: a status, no date
  },
  "property": {
    "property_type": "Vacant land",
    "land_size": 846, "land_unit": "m²",
    "bedrooms": null, "bathrooms": null, "parking": null   // often null on sale listings
  }
}
```

## Field mappings

### Sold → `property_sales`  (already loaded; ~25k rows via `scripts/ingest-domain-apify.mjs`)
| property_sales      | from                                                              |
|---------------------|-------------------------------------------------------------------|
| `raw_address`       | `location.display_address`                                        |
| `suburb/state/postcode` | `location.*`                                                  |
| `sale_price`        | parse `pricing.display_price` → digits → number (skip if none)    |
| `sale_date`         | regex `(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})` on `listing.tags.tag_text` → `YYYY-MM-DD` |
| `land_area_sqm`     | `property.land_size`                                              |
| `property_type`     | `property.property_type`                                          |
| `latitude/longitude`| `location.latitude/longitude`                                     |
| `source`            | `'domain-apify'`                                                  |
| dedup key           | `(raw_address, sale_date, sale_price, source)`                    |

### On-market → new `property_listings` table  (1,391 records in `V56AzVH6c9Bf2XNUN`, not yet loaded)
| property_listings   | from                                                              |
|---------------------|-------------------------------------------------------------------|
| `raw_address`       | `location.display_address`                                        |
| `suburb/state/postcode` | `location.*`                                                  |
| `display_price`     | `pricing.display_price` (keep raw string)                         |
| `price_low/price_high` | parse the range out of `display_price` (two `$` amounts; if single, low=high; if none, null) |
| `status`            | `listing.tags.tag_text` (e.g. "Under offer", "Under contract") or null |
| `land_area_sqm`     | `property.land_size`                                              |
| `property_type`     | `property.property_type`                                          |
| `latitude/longitude`| `location.latitude/longitude`                                     |
| `source`            | `'domain-apify'`                                                  |
| dedup key           | `(raw_address, source)`                                           |

## Status / what's done

- **Sold** data is already in `property_sales` (~25k rows). Coords pending the additive
  `ALTER TABLE property_sales ADD latitude/longitude` + a merge re-ingest (see ingestion prompt).
- **On-market** (1,391 records) is sitting in dataset `V56AzVH6c9Bf2XNUN`, ready to load once the
  `property_listings` table exists.
