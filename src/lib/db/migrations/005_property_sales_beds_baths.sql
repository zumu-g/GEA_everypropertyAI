-- 005: add bed/bath/car columns to property_sales
-- The Domain sold feed includes these per listing, but property_sales never
-- stored them. Needed so sold comparables (e.g. GEA_ST_proposals CMA) keep
-- beds/baths when sourced from everypropertyAI. Idempotent.

ALTER TABLE property_sales
  ADD COLUMN IF NOT EXISTS bedrooms   smallint,
  ADD COLUMN IF NOT EXISTS bathrooms  smallint,
  ADD COLUMN IF NOT EXISTS car_spaces smallint;
