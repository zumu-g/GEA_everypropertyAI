#!/usr/bin/env python3
"""Build src/data/childcare-data.json: authoritative childcare services with
NQS quality ratings for the Casey/Cardinia region.

Source (open data, updated daily by ACECQA from the NQA IT System):
  - ACECQA national registers, VIC services CSV export:
    https://www.acecqa.gov.au/resources/national-registers
    (per-state export files under /sites/default/files/national-registers/services/)

The register has street address + suburb + postcode but NO coordinates, so we
geocode each centre once at build time via Nominatim (1.1 s/request, results
cached in cache_dir so re-runs are cheap). Centres that fail street-level
geocoding fall back to their suburb centroid and are flagged approx.

Usage: python3 scripts/build-childcare-data.py [cache_dir]
Re-run periodically (ratings change after assessment visits).
"""

import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

CSV_URL = "https://www.acecqa.gov.au/sites/default/files/national-registers/services/Education-services-vic-export.csv"

# Casey/Cardinia postcodes (project scope)
POSTCODES = {str(p) for p in list(range(3800, 3817)) + list(range(3975, 3981))}
# Casey/Cardinia + margin; must match src/lib/enrichment bbox
BBOX = {"min_lng": 145.05, "max_lng": 145.90, "min_lat": -38.40, "max_lat": -37.85}

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "childcare-data.json")
UA = {"User-Agent": "PropertyIQ-build/1.0 (childcare data build script)"}


def fetch(url: str, cache_dir: str, name: str) -> str:
    path = os.path.join(cache_dir, name)
    if not os.path.exists(path):
        print(f"downloading {url}")
        req = urllib.request.Request(url, headers={**UA, "User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def in_bbox(lng: float, lat: float) -> bool:
    return (BBOX["min_lng"] <= lng <= BBOX["max_lng"]
            and BBOX["min_lat"] <= lat <= BBOX["max_lat"])


_last = [0.0]


def nominatim(params: dict):
    """Rate-limited Nominatim search; returns (lat, lng) or None."""
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&" \
          + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
            data = json.load(r)
    except Exception as e:
        print(f"  geocode error: {e}")
        return None
    if not data:
        return None
    lat, lng = float(data[0]["lat"]), float(data[0]["lon"])
    return (lat, lng) if in_bbox(lng, lat) else None


def geocode(row: dict, geo_cache: dict, suburb_cache: dict):
    """Street-level geocode with suburb-centroid fallback. Returns (lat, lng, approx)."""
    street, suburb, pc = row["ServiceAddress"].strip(), row["Suburb"].strip(), row["Postcode"].strip()
    key = f"{street}|{suburb}|{pc}".lower()
    if key not in geo_cache:
        geo_cache[key] = nominatim({"street": street, "city": suburb, "postalcode": pc,
                                    "state": "Victoria"})
    if geo_cache[key]:
        lat, lng = geo_cache[key]
        return lat, lng, False
    if suburb not in suburb_cache:
        suburb_cache[suburb] = nominatim({"city": suburb, "postalcode": pc, "state": "Victoria"})
    if suburb_cache[suburb]:
        lat, lng = suburb_cache[suburb]
        return lat, lng, True
    return None, None, True


def main():
    cache_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/childcare-data-cache"
    os.makedirs(cache_dir, exist_ok=True)
    csv_path = fetch(CSV_URL, cache_dir, "acecqa-vic.csv")

    geo_cache_path = os.path.join(cache_dir, "geocode-cache.json")
    geo_cache = json.load(open(geo_cache_path)) if os.path.exists(geo_cache_path) else {}
    suburb_cache = {}

    with open(csv_path, encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r["Postcode"] in POSTCODES]
    print(f"{len(rows)} services in Casey/Cardinia postcodes")

    centres, exact = [], 0
    for i, r in enumerate(rows):
        lat, lng, approx = geocode(r, geo_cache, suburb_cache)
        if i % 25 == 0:
            json.dump(geo_cache, open(geo_cache_path, "w"))
            print(f"  geocoded {i}/{len(rows)}")
        if lat is None:
            print(f"  SKIP (no geocode): {r['ServiceName']}, {r['Suburb']}")
            continue
        exact += not approx
        centres.append({
            "name": r["ServiceName"].strip(),
            "address": f"{r['ServiceAddress'].strip()}, {r['Suburb'].strip().title()}",
            "suburb": r["Suburb"].strip().title(),
            "type": r["ServiceType"].strip(),
            "nqsRating": r["OverallRating"].strip() or None,
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "approx": approx or None,  # suburb-centroid only
        })
    json.dump(geo_cache, open(geo_cache_path, "w"))

    rated = sum(1 for c in centres if c["nqsRating"])
    out = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "ACECQA national registers (VIC services export)",
        "bbox": BBOX,
        "centres": [{k: v for k, v in c.items() if v is not None} for c in centres],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(centres)} centres ({exact} street-level, "
          f"{len(centres) - exact} suburb-level), {rated} with NQS rating, "
          f"{os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main()
