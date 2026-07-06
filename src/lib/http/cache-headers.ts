/**
 * Browser-side caching for public, non-user-specific GET API responses.
 *
 * `private` (not `public`) is deliberate: production runs on Railway with no CDN
 * in front honouring shared-cache directives like `s-maxage`, so a `public`
 * directive would just be inert. `private` is honoured by the requesting
 * browser directly — a revisit or back/forward navigation to the same query is
 * served from that browser's own cache with no network round-trip, no infra
 * dependency, and no risk of one caller's response being served to another.
 *
 * Never apply this to routes that read the session, an API key identity, or
 * user-scoped tables — see each route's own audit note.
 */
export const PUBLIC_GET_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=300, stale-while-revalidate=86400',
};
