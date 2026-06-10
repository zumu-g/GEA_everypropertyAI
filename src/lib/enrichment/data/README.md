# Bundled enrichment reference data

Generated, committed reference files consumed at runtime by the enrichment
modules. Do **not** hand-edit — regenerate from the documented recipes.

## School zones (plan 005)

- `school-zones-primary.casey-cardinia.json`
- `school-zones-secondary.casey-cardinia.json`

WGS84 GeoJSON `FeatureCollection`s of Victorian government-school catchments
clipped to Casey + Cardinia; each feature exposes a `school` name property. Read
by `src/lib/enrichment/school-zones.ts` via local point-in-polygon.

**Generate with `scripts/prep-school-zones.md`** (needs GDAL/`ogr2ogr` + the
data.vic.gov.au dataset download). Until generated, `resolveSchoolZones` returns
`{}` (fail-soft) and the `school_zone_*` columns stay null — no error.
