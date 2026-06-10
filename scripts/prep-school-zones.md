# Prep: Victorian school-zone reference data (Casey + Cardinia)

Generates the bundled GeoJSON the runtime school-zone lookup reads
(`src/lib/enrichment/school-zones.ts`). Run **once per DET dataset year**; the
output files are committed so contributors don't need GDAL to build/test.

> **Source is DET school *zones*, not My School.** ACARA's My School
> (`myschool.edu.au`) is performance data with no catchment geometry. The
> authoritative catchment polygons are the **"Victorian Government School Zones"**
> datasets on **data.vic.gov.au** (the same data behind
> `findmyschool.vic.gov.au`).

## Output (committed)

- `src/lib/enrichment/data/school-zones-primary.casey-cardinia.json`
- `src/lib/enrichment/data/school-zones-secondary.casey-cardinia.json`

Both are WGS84 (EPSG:4326) GeoJSON `FeatureCollection`s. Every feature must expose
a single stable **`school`** string property (the catchment's school name) — the
runtime lookup keys on `feature.properties.school`.

## Dataset

- Portal: <https://discover.data.vic.gov.au/dataset/victorian-government-school-zones-2026>
  (bump the year when DET republishes — 2027 etc. Record the year + download date below.)
- The download contains **separate layers**: one primary-zone layer and one
  secondary-zone layer **per year level** of secondary.
  - **Primary** → use the primary-zone layer.
  - **Secondary** → use the **Year 7** layer as the single representative
    secondary zone (covers the common 7–12 case). Per-year granularity is out of
    scope (see plan 005).
- Projection in the source: **GDA94 VicGrid, EPSG:3111** — must be reprojected to
  EPSG:4326 (handled below).

## Tooling

`ogr2ogr` (GDAL) — understands EPSG:3111 natively and does reproject + clip +
field-select + simplify in one pass.

```sh
brew install gdal        # macOS
```

`mapshaper` (npm) is a viable alternative but needs an explicit proj4 def for
EPSG:3111; `ogr2ogr` is simpler here.

## Clip extent: Casey + Cardinia

Clip to the two LGAs the project is restricted to. Use the Casey + Cardinia LGA
polygons from the Vicmap / data.vic LGA dataset
(<https://discover.data.vic.gov.au/dataset/vicmap-admin>) as `casey-cardinia-lga.geojson`,
or fall back to a tight bounding box of the two LGAs:

```
# Casey + Cardinia approximate bbox (WGS84): minLng minLat maxLng maxLat
145.18 -38.40 145.62 -37.92
```

## Commands

```sh
# Primary zones
ogr2ogr \
  -f GeoJSON \
  -t_srs EPSG:4326 \
  -clipsrc casey-cardinia-lga.geojson \
  -simplify 0.00005 \
  -sql "SELECT <SCHOOL_NAME_FIELD> AS school FROM <PRIMARY_LAYER>" \
  src/lib/enrichment/data/school-zones-primary.casey-cardinia.json \
  <downloaded-zones>.gdb_or_shp

# Secondary zones (Year 7 layer as the single representative secondary zone)
ogr2ogr \
  -f GeoJSON \
  -t_srs EPSG:4326 \
  -clipsrc casey-cardinia-lga.geojson \
  -simplify 0.00005 \
  -sql "SELECT <SCHOOL_NAME_FIELD> AS school FROM <SECONDARY_YEAR7_LAYER>" \
  src/lib/enrichment/data/school-zones-secondary.casey-cardinia.json \
  <downloaded-zones>.gdb_or_shp
```

Replace `<SCHOOL_NAME_FIELD>` / `<...LAYER>` with the actual attribute and layer
names from the downloaded dataset (inspect with `ogrinfo -so <file>`).
`-clipsrc <bbox>` (the four numbers above) may replace the LGA file if simpler.

## Sanity checks (do before committing)

- Both files parse as valid GeoJSON `FeatureCollection`s.
- Coordinate bounds fall within ~144.9–145.6 E / −37.8–−38.4 S (Casey/Cardinia,
  WGS84) — confirms the reprojection went the right way.
- Every feature has a non-empty `school` property.
- Feature counts are plausible for the two LGAs (tens, not thousands).
- File size is sub-megabyte each (increase `-simplify` tolerance if larger).

## Refresh log

| Dataset year | Downloaded | By |
|---|---|---|
| _e.g. 2026_ | _YYYY-MM-DD_ | _name_ |
