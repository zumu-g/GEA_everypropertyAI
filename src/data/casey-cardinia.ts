/**
 * Shared Casey / Cardinia (SE Melbourne corridor) reference data.
 *
 * Used by the VG ingest route (postcode filter) and the backfill orchestrator
 * (suburb universe). Suburb ranking for the backfill is derived at runtime from
 * `property_sales` counts — this static list is only the postcode/suburb scope.
 */

/** Postcodes covering City of Casey + Shire of Cardinia. */
export const CASEY_CARDINIA_POSTCODES: ReadonlySet<string> = new Set([
  '3800', '3802', '3803', '3804', '3805', '3806', '3807', '3808', '3809',
  '3810', '3811', '3812', '3813', '3814', '3815', '3816',
  '3977', '3978', '3979', '3980',
]);

export const STATE = 'VIC';
