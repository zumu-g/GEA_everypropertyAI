import type {
  AgentListingsResponse,
  CmaPack,
  ComparableResult,
  EnrichResponse,
  MergedPropertyProfile,
  OnMarketListing,
  ProposalPropertyData,
  PropertyResponse,
  ReaSuggestion,
  RentalListing,
  SoldSaleResult,
  StreetRow,
  StructuredAddress,
  VendorReportResponse,
} from "./types.js";

/**
 * Per-request fetch timeouts. A live crawl (POST /api/property) runs ≤110s
 * synchronously, so property/proposal tools get 130s; every other endpoint is
 * a fast DB query and gets the 30s default.
 */
const CRAWL_TIMEOUT_MS = 130_000;
const DEFAULT_TIMEOUT_MS = 30_000;

// Street-type splitter — mirrors src/components/search/AddressSearch.tsx so the
// StructuredAddress we build matches exactly what the app's UI sends to /api/property.
const STREET_ADDRESS_RE =
  /^(\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?)\s+(.+?)(?:\s+(St|Rd|Ave|Dr|Cres|Ct|Pl|Ln|Tce|Pde|Cct|Cl|Way|Gr|Blvd|Hwy|Esp|Prom|Circuit|Street|Road|Avenue|Drive|Crescent|Court|Place|Lane|Terrace|Parade|Close|Grove|Boulevard|Highway))?\s*$/i;

function suggestionToAddress(s: ReaSuggestion): StructuredAddress {
  const parts = s.streetAddress.match(STREET_ADDRESS_RE);
  return {
    streetNumber: parts?.[1] ?? "",
    streetName: parts?.[2] ?? s.streetAddress,
    streetType: parts?.[3] ?? "",
    suburb: s.suburb,
    state: s.state,
    postcode: s.postcode,
    displayAddress: s.fullAddress,
  };
}

export interface ClientOptions {
  /** Base URL of the running PropertyIQ app. Default: $EVERYPROPERTY_API_URL or http://localhost:3007 */
  baseUrl?: string;
  /** Optional bearer token sent as Authorization header. Default: $EVERYPROPERTY_API_TOKEN */
  token?: string;
  /** Default per-request timeout (ms) for fast endpoints. Property/proposal override to 130s. Default: 30000. */
  timeoutMs?: number;
}

export class PropertyIQError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = "PropertyIQError";
  }
}

/** Read the first present, non-null field from a loose data map. */
function pick<T = unknown>(data: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Typed client over PropertyIQ's HTTP API. The shared core for both the MCP
 * server and the CLI. Wraps the existing routes — no business logic is
 * duplicated; the app keeps owning scraping/merge/cache.
 */
export class PropertyIQClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (
      opts.baseUrl ?? process.env.EVERYPROPERTY_API_URL ?? "http://localhost:3007"
    ).replace(/\/$/, "");
    this.token = opts.token ?? process.env.EVERYPROPERTY_API_TOKEN;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    path: string,
    init: {
      method?: "GET" | "POST";
      query?: Record<string, unknown>;
      body?: unknown;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs ?? this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new PropertyIQError(
        `Request to ${url.pathname} failed (${msg}). Is the PropertyIQ app running at ${this.baseUrl}?`,
      );
    }
    const text = await res.text();
    if (res.status === 401) {
      // Auth failure: make the cause + remediation explicit rather than an opaque
      // "returned 401". The two real causes (no token attached vs a token the
      // server rejects) need different fixes, so report which one happened.
      const cause = this.token
        ? "a token was attached but the server rejected it — it is not in the server's EVERYPROPERTY_API_KEYS"
        : "no API token was attached — set EVERYPROPERTY_API_TOKEN (or pass { token })";
      throw new PropertyIQError(
        `everypropertyai: ${url.pathname} returned 401 (${cause}). ` +
          `The token must be one of the server's EVERYPROPERTY_API_KEYS.`,
        401,
        text,
      );
    }
    if (!res.ok) {
      throw new PropertyIQError(`${url.pathname} returned ${res.status}`, res.status, text);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PropertyIQError(`${url.pathname} returned non-JSON response`, res.status, text);
    }
  }

  // ── Primitives (1:1 with the API) ─────────────────────────────────────────

  /**
   * Address suggestions via /api/address-suggest (REA) — the same source the app's
   * UI uses, with clean suburb/state/postcode (unlike the Mapbox /api/search parse).
   */
  suggestAddresses(query: string, state?: string): Promise<{ suggestions: ReaSuggestion[] }> {
    return this.request("/api/address-suggest", { query: { q: query, state } });
  }

  /** Resolve a free-text address to a clean StructuredAddress, matching the UI. */
  async resolveAddress(addressOrQuery: string | StructuredAddress): Promise<StructuredAddress> {
    if (typeof addressOrQuery !== "string") return addressOrQuery;
    const { suggestions } = await this.suggestAddresses(addressOrQuery);
    if (!suggestions?.length) {
      throw new PropertyIQError(`No address match for "${addressOrQuery}"`);
    }
    return suggestionToAddress(suggestions[0]);
  }

  /**
   * Full merged property profile. `fast` mode (used by the CLI `property`
   * command / CRM enrichment) returns a quick partial from high-value sources and
   * fills the rest in the background — avoids the ~120s live-crawl wait. cma/proposal
   * leave it off to get the complete crawl.
   */
  async fetchProperty(
    addressOrQuery: string | StructuredAddress,
    opts?: { fast?: boolean },
  ): Promise<PropertyResponse> {
    const address = await this.resolveAddress(addressOrQuery);
    return this.request("/api/property", {
      method: "POST",
      body: { address, fast: opts?.fast ?? false },
      timeoutMs: CRAWL_TIMEOUT_MS,
    });
  }

  comparableSales(params: {
    suburb: string;
    state?: string;
    beds?: number;
    baths?: number;
    propertyType?: string;
    excludeSlug?: string;
  }): Promise<{ comparables: ComparableResult[] }> {
    return this.request("/api/comparable-sales", { query: { state: "VIC", ...params } });
  }

  soldSales(params: {
    suburb: string;
    state?: string;
    minPrice?: number;
    maxPrice?: number;
    sinceDays?: number;
    limit?: number;
  }): Promise<{ suburb: string; state: string; count: number; results: SoldSaleResult[] }> {
    return this.request("/api/sold-sales", { query: { state: "VIC", ...params } });
  }

  onMarketListings(params: {
    suburb?: string;
    state?: string;
    lat?: number;
    lng?: number;
    radius?: number;
    sinceDays?: number;
    limit?: number;
  }): Promise<{ suburb: string | null; state: string; count: number; results: OnMarketListing[] }> {
    return this.request("/api/on-market-listings", { query: { state: "VIC", ...params } });
  }

  rentalListings(params: {
    suburb?: string;
    state?: string;
    lat?: number;
    lng?: number;
    radius?: number;
    sinceDays?: number;
    minRent?: number;
    maxRent?: number;
    limit?: number;
  }): Promise<{ suburb: string | null; state: string; count: number; results: RentalListing[] }> {
    return this.request("/api/rental-listings", { query: { state: "VIC", ...params } });
  }

  enrich(params: {
    address?: string;
    suburb: string;
    state: string;
    postcode: string;
  }): Promise<EnrichResponse> {
    return this.request("/api/enrich", { query: params });
  }

  streetDetails(
    query: string,
  ): Promise<{ rows: StreetRow[]; streetLabel: string; locationLabel: string }> {
    return this.request("/api/street-details", { query: { q: query } });
  }

  /**
   * An agent's recent listings + sales (≤20, newest first). Provide `name`
   * (+ optional `agency` to disambiguate) OR `agentId`. An unknown agent
   * returns 200 `{ agent: null, listings: [] }` — not an error.
   */
  agentListings(params: {
    name?: string;
    agency?: string;
    agentId?: string;
  }): Promise<AgentListingsResponse> {
    return this.request("/api/agents/listings", { query: params });
  }

  /**
   * Vendor report around a point: the 3 closest sold sales + 3 newest on-market
   * listings. Provide `address` (geocoded server-side) OR `lat`+`lng`. `radius`
   * is in km; `excludeAddress` drops the subject property from the results.
   */
  vendorReport(params: {
    address?: string;
    lat?: number;
    lng?: number;
    radius?: number;
    excludeAddress?: string;
  }): Promise<VendorReportResponse> {
    return this.request("/api/vendor-report", { query: params });
  }

  // ── Composites (everypropertyAI value-add) ────────────────────────────────

  private subjectFrom(profile: MergedPropertyProfile) {
    const d = profile.data ?? {};
    // The merger stores the price estimate as flat fields (priceLow/Mid/High/Source).
    const low = asNumber(pick(d, ["priceLow"]));
    const mid = asNumber(pick(d, ["priceMid"]));
    const high = asNumber(pick(d, ["priceHigh"]));
    const priceEstimate =
      low || mid || high
        ? { low, mid, high, source: pick<string>(d, ["priceSource"]) }
        : pick(d, ["priceEstimate", "enrichedEstimate", "estimate", "valuation", "estimatedValue"]);
    return {
      bedrooms: asNumber(pick(d, ["bedrooms", "beds"])),
      bathrooms: asNumber(pick(d, ["bathrooms", "baths"])),
      carSpaces: asNumber(pick(d, ["carSpaces", "carspaces", "parking", "garages"])),
      landAreaSqm: asNumber(pick(d, ["landAreaSqm", "landSize", "landArea"])),
      propertyType: pick<string>(d, ["propertyType", "type"]),
      priceEstimate,
      priceMid: mid,
      agency: pick<string>(d, ["agency", "agencyName"]),
      agentName: pick<string>(d, ["agentName", "agent"]),
      description: pick<string>(d, ["description", "summary"]),
      photos: (pick<unknown[]>(d, ["photos", "media", "images"]) ?? []) as unknown[],
    };
  }

  /** Bundle subject + comps + recent suburb sales + suburb stats for a CMA. */
  async cmaPack(
    addressOrQuery: string | StructuredAddress,
    nowIso: string = "",
  ): Promise<CmaPack> {
    const address = await this.resolveAddress(addressOrQuery);
    const { profile, source, addressSlug } = await this.fetchProperty(address);
    const s = this.subjectFrom(profile);

    const [comps, sold, enriched] = await Promise.all([
      this.comparableSales({
        suburb: address.suburb,
        state: address.state,
        beds: s.bedrooms,
        baths: s.bathrooms,
        propertyType: s.propertyType,
        excludeSlug: addressSlug,
      }).catch(() => ({ comparables: [] as ComparableResult[] })),
      this.soldSales({ suburb: address.suburb, state: address.state, limit: 25 }).catch(() => ({
        results: [] as SoldSaleResult[],
        suburb: address.suburb,
        state: address.state,
        count: 0,
      })),
      this.enrich({
        suburb: address.suburb,
        state: address.state,
        postcode: address.postcode,
      }).catch(() => ({} as EnrichResponse)),
    ]);

    return {
      address: address.displayAddress ?? `${address.streetNumber} ${address.streetName} ${address.streetType}, ${address.suburb} ${address.state} ${address.postcode}`,
      addressSlug,
      source,
      subject: {
        bedrooms: s.bedrooms,
        bathrooms: s.bathrooms,
        carSpaces: s.carSpaces,
        landAreaSqm: s.landAreaSqm,
        propertyType: s.propertyType,
        overallConfidence: profile.overallConfidence,
      },
      priceEstimate: s.priceEstimate,
      comparables: comps.comparables,
      recentSuburbSales: sold.results,
      suburbStats: enriched.suburbStats,
      marketData: enriched.marketData,
      generatedAt: nowIso,
    };
  }

  /** Presentation-ready subset for a proposal document. */
  async proposalPropertyData(
    addressOrQuery: string | StructuredAddress,
  ): Promise<ProposalPropertyData> {
    const address = await this.resolveAddress(addressOrQuery);
    const { profile, addressSlug } = await this.fetchProperty(address);
    const s = this.subjectFrom(profile);

    const heroPhotos = s.photos
      .map((p) => (typeof p === "string" ? p : (p as { url?: string })?.url))
      .filter((u): u is string => typeof u === "string")
      .slice(0, 6);

    return {
      address: address.displayAddress ?? `${address.streetNumber} ${address.streetName} ${address.streetType}, ${address.suburb} ${address.state} ${address.postcode}`,
      addressSlug,
      bedrooms: s.bedrooms,
      bathrooms: s.bathrooms,
      carSpaces: s.carSpaces,
      landAreaSqm: s.landAreaSqm,
      propertyType: s.propertyType,
      priceEstimate: s.priceEstimate,
      formattedEstimate:
        s.priceMid !== undefined
          ? s.priceMid.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 })
          : undefined,
      agency: s.agency,
      agentName: s.agentName,
      heroPhotos,
      suburb: address.suburb,
      description: s.description,
      confidence: profile.overallConfidence,
    };
  }
}
