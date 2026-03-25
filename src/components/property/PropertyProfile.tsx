"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  MapPin,
  GraduationCap,
  Train,
  Building2,
  TrendingUp,
  Shield,
  Layers,
  Users,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { Skeleton } from "../ui/Skeleton";
import type { MergedPropertyProfile, StructuredAddress } from "@/types/property";

interface EnrichmentData {
  coordinates: { lat: number; lng: number } | null;
  planning: {
    zone?: { code: string; name: string; description?: string };
    overlays: Array<{ code: string; name: string }>;
    council?: string;
    planningScheme?: string;
    source: string;
  } | null;
  schools: Array<{
    name: string;
    type: string;
    sector: string;
    distanceKm: number;
  }>;
  transport: Array<{
    name: string;
    type: string;
    distanceKm: number;
  }>;
  suburbStats: {
    suburb: string;
    state: string;
    medianHousePrice?: number;
    medianUnitPrice?: number;
    annualGrowthPercent?: number;
    averageDaysOnMarket?: number;
    population?: number;
    medianAge?: number;
    ownerOccupiedPercent?: number;
    renterPercent?: number;
    familyPercent?: number;
  } | null;
  buyerDemand: {
    level: 'very-low' | 'low' | 'moderate' | 'high' | 'very-high';
    score: number;
    factors: Array<{ name: string; value: string; impact: 'positive' | 'neutral' | 'negative' }>;
    medianHousePrice?: number;
    medianUnitPrice?: number;
    medianRentHouse?: number;
    medianRentUnit?: number;
    annualGrowth?: number;
    avgDaysOnMarket?: number;
    auctionClearance?: number;
    totalListings?: number;
  } | null;
  marketData: {
    suburb: string;
    houses: {
      medianPrice?: number;
      quarterlyGrowth?: number;
      annualGrowth?: number;
      medianRent?: number;
      grossYield?: number;
      salesCount?: number;
      avgDaysOnMarket?: number;
      monthlyMedians?: Array<{ month: string; value: number }>;
    };
    units: {
      medianPrice?: number;
      quarterlyGrowth?: number;
      annualGrowth?: number;
      medianRent?: number;
      grossYield?: number;
      salesCount?: number;
      avgDaysOnMarket?: number;
      monthlyMedians?: Array<{ month: string; value: number }>;
    };
    demographics?: {
      population?: number;
      populationGrowth?: number;
      medianHouseholdIncome?: number;
      predominantAgeGroup?: string;
      ownerOccupiedPercent?: number;
      topOccupation?: string;
    };
    source: string;
  } | null;
}

interface PropertyProfileProps {
  address: string;
}

export function PropertyProfile({ address }: PropertyProfileProps) {
  const [property, setProperty] = useState<MergedPropertyProfile | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedAddress, setParsedAddress] = useState<StructuredAddress | null>(
    null
  );

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const fetchProperty = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let structured: StructuredAddress;
      try {
        structured = JSON.parse(address);
      } catch {
        structured = {
          streetNumber: "",
          streetName: address,
          streetType: "",
          suburb: "",
          state: "",
          postcode: "",
        };
      }
      setParsedAddress(structured);

      const res = await fetch("/api/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: structured }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || "Failed to load property data. Please try again."
        );
      }
      const data = await res.json();
      setProperty(data.profile);

      // Kick off enrichment fetch in background
      fetchEnrichment(structured);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  const fetchEnrichment = async (structured: StructuredAddress) => {
    setEnrichLoading(true);
    try {
      const fullAddr =
        structured.displayAddress ??
        [
          structured.streetNumber,
          structured.streetName,
          structured.streetType,
        ]
          .filter(Boolean)
          .join(" ") +
          `, ${structured.suburb} ${structured.state} ${structured.postcode}`;

      const params = new URLSearchParams({
        address: fullAddr,
        suburb: structured.suburb ?? "",
        state: structured.state ?? "",
        postcode: structured.postcode ?? "",
      });

      const res = await fetch(`/api/enrich?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEnrichment(data);
      }
    } catch (err) {
      console.warn("[PropertyProfile] Enrichment failed:", err);
    } finally {
      setEnrichLoading(false);
    }
  };

  useEffect(() => {
    if (address) fetchProperty();
  }, [address, fetchProperty]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Progress indicator */}
        <div className="mb-10 flex flex-col items-center justify-center py-12">
          <div className="relative mb-6">
            <div className="h-16 w-16 rounded-full border-4 border-gray-200" />
            <div className="absolute inset-0 h-16 w-16 animate-spin rounded-full border-4 border-transparent border-t-brand-600" />
            <Building2 className="absolute inset-0 m-auto h-6 w-6 text-brand-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">
            Searching property data
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Crawling realestate.com.au, domain.com.au and more...
          </p>
        </div>

        {/* Skeleton preview */}
        <div className="space-y-8">
          <Skeleton height="16rem" rounded="xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height="6rem" rounded="xl" />
            ))}
          </div>
          <Skeleton height="10rem" rounded="xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-md"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">
            Something went wrong
          </h2>
          <p className="mt-2 text-gray-600">{error}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Search
            </Link>
            <button
              onClick={fetchProperty}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 active:scale-[0.97]"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!property) return null;

  const d = property.data;
  const addr = (d.address as Record<string, unknown>) ?? {};
  const displayAddress =
    parsedAddress?.displayAddress ??
    (addr.fullAddress as string) ??
    [addr.streetNumber, addr.streetName, addr.streetType]
      .filter(Boolean)
      .join(" ") +
      (addr.suburb ? `, ${addr.suburb}` : "") +
      (addr.state ? ` ${addr.state}` : "") +
      (addr.postcode ? ` ${addr.postcode}` : "");

  const photos = (d.photos as string[]) ?? [];
  const heroImage = photos[0] ?? null;
  const propertyType = (d.propertyType as string) ?? "Property";
  const saleHistory =
    (d.saleHistory as Array<{
      price?: number;
      date?: string;
      type?: string;
    }>) ?? [];
  const features = (d.features as string[]) ?? [];
  const priceLabel = d.priceLabel != null ? String(d.priceLabel) : null;
  const priceLow = d.priceLow != null ? Number(d.priceLow) : null;
  const priceMid = d.priceMid != null ? Number(d.priceMid) : null;
  const priceHigh = d.priceHigh != null ? Number(d.priceHigh) : null;
  const currentPrice = d.currentPrice != null ? Number(d.currentPrice) : null;

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors duration-150 hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Search
      </Link>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="space-y-10"
      >
        {/* ─── Hero ─── */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="relative h-64 w-full sm:h-80 lg:h-96">
            {heroImage ? (
              <img
                src={heroImage}
                alt={displayAddress}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-brand-600 to-brand-900" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
              <span className="mb-2 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {propertyType.charAt(0).toUpperCase() + propertyType.slice(1)}
              </span>
              <h1 className="text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
                {displayAddress}
              </h1>
              {parsedAddress?.suburb && (
                <div className="mt-1 flex items-center gap-1 text-sm text-white/80">
                  <MapPin className="h-4 w-4" />
                  <span>
                    {[
                      parsedAddress.suburb,
                      parsedAddress.state,
                      parsedAddress.postcode,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap items-center gap-6 border-t border-gray-100 px-6 py-4 sm:px-8">
            {d.bedrooms != null && (
              <Stat value={String(d.bedrooms)} label="Beds" />
            )}
            {d.bathrooms != null && (
              <Stat value={String(d.bathrooms)} label="Baths" />
            )}
            {d.carSpaces != null && (
              <Stat value={String(d.carSpaces)} label="Cars" />
            )}
            {d.landArea != null && (
              <Stat value={`${String(d.landArea)}m²`} label="Land" />
            )}
          </div>
        </section>

        {/* ─── Estimated Price Range ─── */}
        {(priceLow != null || priceMid != null || currentPrice != null || priceLabel != null) && (
          <section>
            <SectionTitle icon={TrendingUp} title="Estimated Price Range" />
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              {(priceLow != null && priceHigh != null) ? (
                <div>
                  <div className="flex items-end gap-4 mb-4">
                    <div className="text-center flex-1">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Low</p>
                      <p className="text-xl font-bold text-gray-500">{fmtCurrency(priceLow)}</p>
                    </div>
                    <div className="text-center flex-1">
                      <p className="text-xs font-medium text-brand-500 uppercase tracking-wide">Estimated</p>
                      <p className="text-3xl font-extrabold text-brand-600">{fmtCurrency(priceMid ?? currentPrice ?? 0)}</p>
                    </div>
                    <div className="text-center flex-1">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">High</p>
                      <p className="text-xl font-bold text-gray-500">{fmtCurrency(priceHigh)}</p>
                    </div>
                  </div>
                  <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-r from-gray-300 via-brand-500 to-gray-300" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white border-3 border-brand-600 shadow-md" />
                  </div>
                  {priceLabel && (
                    <p className="mt-3 text-sm text-gray-500 text-center">{priceLabel}</p>
                  )}
                </div>
              ) : currentPrice != null ? (
                <div className="text-center">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Guide Price</p>
                  <p className="text-3xl font-extrabold text-brand-600">{fmtCurrency(currentPrice)}</p>
                  {priceLabel && <p className="mt-2 text-sm text-gray-500">{priceLabel}</p>}
                </div>
              ) : priceLabel ? (
                <div className="text-center">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Price Guide</p>
                  <p className="text-2xl font-bold text-gray-900">{priceLabel}</p>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {/* ─── Buyer Demand ─── */}
        {enrichment?.buyerDemand && (
          <section>
            <SectionTitle icon={Users} title="Buyer Demand" />
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-4 mb-5">
                <DemandGauge score={enrichment.buyerDemand.score} level={enrichment.buyerDemand.level} />
                <div>
                  <p className="text-lg font-bold text-gray-900 capitalize">
                    {enrichment.buyerDemand.level.replace('-', ' ')} demand
                  </p>
                  <p className="text-sm text-gray-500">
                    Based on {enrichment.buyerDemand.factors.length} market indicators
                  </p>
                </div>
              </div>

              {/* Factors */}
              <div className="space-y-2">
                {enrichment.buyerDemand.factors.map((f, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5">
                    <span className="text-sm text-gray-700">{f.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{f.value}</span>
                      <span className={`h-2 w-2 rounded-full ${
                        f.impact === 'positive' ? 'bg-green-500' :
                        f.impact === 'negative' ? 'bg-red-400' : 'bg-amber-400'
                      }`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ─── Market Overview (CoreLogic data) ─── */}
        {enrichment?.marketData && (
          <section>
            <SectionTitle icon={Building2} title={`${enrichment.marketData.suburb} Market Overview`} />

            {/* Houses vs Units comparison */}
            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              {/* Houses */}
              <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Houses</h4>
                <div className="space-y-3">
                  {enrichment.marketData.houses.medianPrice != null && (
                    <DataRow label="Median Price" value={fmtCurrency(enrichment.marketData.houses.medianPrice)} />
                  )}
                  {enrichment.marketData.houses.annualGrowth != null && (
                    <DataRow label="Annual Growth" value={`${enrichment.marketData.houses.annualGrowth > 0 ? '+' : ''}${enrichment.marketData.houses.annualGrowth}%`}
                      color={enrichment.marketData.houses.annualGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.houses.quarterlyGrowth != null && (
                    <DataRow label="Quarterly Growth" value={`${enrichment.marketData.houses.quarterlyGrowth > 0 ? '+' : ''}${enrichment.marketData.houses.quarterlyGrowth}%`}
                      color={enrichment.marketData.houses.quarterlyGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.houses.medianRent != null && (
                    <DataRow label="Median Rent" value={`$${enrichment.marketData.houses.medianRent}/wk`} />
                  )}
                  {enrichment.marketData.houses.grossYield != null && (
                    <DataRow label="Gross Yield" value={`${enrichment.marketData.houses.grossYield}%`} />
                  )}
                  {enrichment.marketData.houses.avgDaysOnMarket != null && (
                    <DataRow label="Avg Days on Market" value={`${enrichment.marketData.houses.avgDaysOnMarket} days`} />
                  )}
                  {enrichment.marketData.houses.salesCount != null && (
                    <DataRow label="Sales (12 months)" value={String(enrichment.marketData.houses.salesCount)} />
                  )}
                </div>
              </div>

              {/* Units */}
              <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Units</h4>
                <div className="space-y-3">
                  {enrichment.marketData.units.medianPrice != null && (
                    <DataRow label="Median Price" value={fmtCurrency(enrichment.marketData.units.medianPrice)} />
                  )}
                  {enrichment.marketData.units.annualGrowth != null && (
                    <DataRow label="Annual Growth" value={`${enrichment.marketData.units.annualGrowth > 0 ? '+' : ''}${enrichment.marketData.units.annualGrowth}%`}
                      color={enrichment.marketData.units.annualGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.units.quarterlyGrowth != null && (
                    <DataRow label="Quarterly Growth" value={`${enrichment.marketData.units.quarterlyGrowth > 0 ? '+' : ''}${enrichment.marketData.units.quarterlyGrowth}%`}
                      color={enrichment.marketData.units.quarterlyGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.units.medianRent != null && (
                    <DataRow label="Median Rent" value={`$${enrichment.marketData.units.medianRent}/wk`} />
                  )}
                  {enrichment.marketData.units.grossYield != null && (
                    <DataRow label="Gross Yield" value={`${enrichment.marketData.units.grossYield}%`} />
                  )}
                  {enrichment.marketData.units.avgDaysOnMarket != null && (
                    <DataRow label="Avg Days on Market" value={`${enrichment.marketData.units.avgDaysOnMarket} days`} />
                  )}
                  {enrichment.marketData.units.salesCount != null && (
                    <DataRow label="Sales (12 months)" value={String(enrichment.marketData.units.salesCount)} />
                  )}
                </div>
              </div>
            </div>

            {/* Demographics */}
            {enrichment.marketData.demographics && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {enrichment.marketData.demographics.population != null && (
                  <StatCard label="Population" value={enrichment.marketData.demographics.population.toLocaleString()} />
                )}
                {enrichment.marketData.demographics.medianHouseholdIncome != null && (
                  <StatCard label="Median Household Income" value={`$${enrichment.marketData.demographics.medianHouseholdIncome.toLocaleString()}/wk`} />
                )}
                {enrichment.marketData.demographics.ownerOccupiedPercent != null && (
                  <StatCard label="Owner Occupied" value={`${enrichment.marketData.demographics.ownerOccupiedPercent}%`} />
                )}
                {enrichment.marketData.demographics.predominantAgeGroup && (
                  <StatCard label="Main Age Group" value={enrichment.marketData.demographics.predominantAgeGroup} />
                )}
                {enrichment.marketData.demographics.topOccupation && (
                  <StatCard label="Top Occupation" value={enrichment.marketData.demographics.topOccupation} />
                )}
              </div>
            )}

            <p className="mt-4 text-xs text-gray-400">
              Source: {enrichment.marketData.source}
            </p>
          </section>
        )}

        {/* ─── Property Details ─── */}
        {(d.yearBuilt != null || d.landArea != null) && (
          <section>
            <SectionTitle title="Property Details" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.yearBuilt != null && (
                <StatCard label="Year Built" value={String(d.yearBuilt)} />
              )}
              {d.landArea != null && (
                <StatCard label="Land Area" value={`${d.landArea} m²`} />
              )}
            </div>
          </section>
        )}

        {/* ─── Sale History ─── */}
        {saleHistory.length > 0 && (
          <section>
            <SectionTitle title="Sale History" />
            <div className="space-y-3">
              {saleHistory.map((sale, i) => (
                <div
                  key={i}
                  className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-lg font-bold text-gray-900">
                        {sale.price != null
                          ? fmtCurrency(sale.price)
                          : "Confidential"}
                      </span>
                      {sale.date && (
                        <span className="text-sm text-gray-500">
                          {sale.date}
                        </span>
                      )}
                    </div>
                    {sale.type && (
                      <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {sale.type}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Features ─── */}
        {features.length > 0 && (
          <section>
            <SectionTitle title="Features" />
            <div className="flex flex-wrap gap-2">
              {features.map((f, i) => (
                <span
                  key={i}
                  className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
                >
                  {f}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ─── Enrichment: Loading ─── */}
        {enrichLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
            <span className="text-sm text-gray-500">
              Loading planning, schools, transport &amp; suburb data...
            </span>
          </div>
        )}

        {/* ─── Planning & Zoning ─── */}
        {enrichment?.planning && (
          <section>
            <SectionTitle icon={Layers} title="Planning & Zoning" />
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              {enrichment.planning.zone && (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">
                      {enrichment.planning.zone.code}
                    </span>
                    <span className="text-lg font-semibold text-gray-900">
                      {enrichment.planning.zone.name}
                    </span>
                  </div>
                </div>
              )}

              {enrichment.planning.overlays.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">
                    Planning Overlays
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {enrichment.planning.overlays.map((o, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-medium text-amber-800"
                      >
                        {o.code} — {o.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(enrichment.planning.council ||
                enrichment.planning.planningScheme) && (
                <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                  {enrichment.planning.council && (
                    <span>Council: {enrichment.planning.council}</span>
                  )}
                  {enrichment.planning.planningScheme && (
                    <span>
                      Planning Scheme: {enrichment.planning.planningScheme}
                    </span>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-400">
                Source: {enrichment.planning.source}
              </p>
            </div>
          </section>
        )}

        {/* ─── Nearby Schools ─── */}
        {enrichment && enrichment.schools.length > 0 && (
          <section>
            <SectionTitle icon={GraduationCap} title="Nearby Schools" />
            <div className="grid gap-3 sm:grid-cols-2">
              {enrichment.schools.map((school, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50">
                    <GraduationCap className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {school.name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium">
                        {school.type}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium">
                        {school.sector}
                      </span>
                      <span>{school.distanceKm} km</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Transport ─── */}
        {enrichment && enrichment.transport.length > 0 && (
          <section>
            <SectionTitle icon={Train} title="Transport" />
            <div className="grid gap-3 sm:grid-cols-2">
              {enrichment.transport.map((stop, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                    <Train className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {stop.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      <span className="capitalize">{stop.type}</span> ·{" "}
                      {stop.distanceKm} km
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Suburb Statistics ─── */}
        {enrichment?.suburbStats && (
          <section>
            <SectionTitle
              icon={Building2}
              title={`${enrichment.suburbStats.suburb} Suburb Profile`}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enrichment.suburbStats.medianHousePrice != null && (
                <StatCard
                  label="Median House Price"
                  value={fmtCurrency(enrichment.suburbStats.medianHousePrice)}
                />
              )}
              {enrichment.suburbStats.medianUnitPrice != null && (
                <StatCard
                  label="Median Unit Price"
                  value={fmtCurrency(enrichment.suburbStats.medianUnitPrice)}
                />
              )}
              {enrichment.suburbStats.annualGrowthPercent != null && (
                <StatCard
                  label="Annual Growth"
                  value={`${enrichment.suburbStats.annualGrowthPercent}%`}
                />
              )}
              {enrichment.suburbStats.averageDaysOnMarket != null && (
                <StatCard
                  label="Avg Days on Market"
                  value={String(enrichment.suburbStats.averageDaysOnMarket)}
                />
              )}
              {enrichment.suburbStats.population != null && (
                <StatCard
                  label="Population"
                  value={enrichment.suburbStats.population.toLocaleString()}
                />
              )}
              {enrichment.suburbStats.medianAge != null && (
                <StatCard
                  label="Median Age"
                  value={String(enrichment.suburbStats.medianAge)}
                />
              )}
              {enrichment.suburbStats.ownerOccupiedPercent != null && (
                <StatCard
                  label="Owner Occupied"
                  value={`${enrichment.suburbStats.ownerOccupiedPercent}%`}
                />
              )}
              {enrichment.suburbStats.renterPercent != null && (
                <StatCard
                  label="Renters"
                  value={`${enrichment.suburbStats.renterPercent}%`}
                />
              )}
              {enrichment.suburbStats.familyPercent != null && (
                <StatCard
                  label="Family Households"
                  value={`${enrichment.suburbStats.familyPercent}%`}
                />
              )}
            </div>
          </section>
        )}

        {/* ─── Data Sources ─── */}
        <section className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-900">Data Sources</h2>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
              {property.sources.length +
                (enrichment?.planning ? 1 : 0) +
                (enrichment?.schools.length ? 1 : 0) +
                (enrichment?.suburbStats ? 1 : 0)}{" "}
              sources
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {property.overallConfidence}% confidence
            </span>
          </div>
          <div className="space-y-2">
            {property.sources.map((src, i) => (
              <SourceRow
                key={i}
                name={src.name}
                detail={new Date(src.extractedAt).toLocaleString("en-AU")}
                hasErrors={src.hasErrors}
              />
            ))}
            {enrichment?.planning && (
              <SourceRow name={enrichment.planning.source} detail="Zoning & overlays" />
            )}
            {enrichment && enrichment.schools.length > 0 && (
              <SourceRow
                name="OpenStreetMap (Overpass)"
                detail={`${enrichment.schools.length} schools, ${enrichment.transport.length} transport stops`}
              />
            )}
            {enrichment?.suburbStats && (
              <SourceRow name="realestate.com.au" detail="Suburb statistics" />
            )}
            {enrichment?.coordinates && (
              <SourceRow name="Nominatim (OpenStreetMap)" detail="Geocoding" />
            )}
          </div>
        </section>
      </motion.div>
    </div>
  );
}

/* ─── Small helper components ─── */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-gray-700">
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-sm text-gray-500">{label}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon?: typeof TrendingUp;
  title: string;
}) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {Icon && (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50">
          <Icon className="h-4 w-4 text-brand-600" />
        </div>
      )}
      <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
    </div>
  );
}

function SourceRow({
  name,
  detail,
  hasErrors,
}: {
  name: string;
  detail: string;
  hasErrors?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-50 bg-gray-50 px-4 py-2">
      <span className="font-medium text-gray-900">{name}</span>
      <div className="flex items-center gap-2">
        {hasErrors && <span className="text-xs text-amber-600">partial</span>}
        <span className="text-xs text-gray-500">{detail}</span>
      </div>
    </div>
  );
}

function DataRow({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${
        color === 'green' ? 'text-green-600' : color === 'red' ? 'text-red-500' : 'text-gray-900'
      }`}>{value}</span>
    </div>
  );
}

function DemandGauge({
  score,
  level,
}: {
  score: number;
  level: string;
}) {
  const color =
    level === 'very-high' || level === 'high'
      ? 'text-green-600'
      : level === 'moderate'
      ? 'text-amber-500'
      : 'text-red-400';

  const bgColor =
    level === 'very-high' || level === 'high'
      ? 'bg-green-50 border-green-200'
      : level === 'moderate'
      ? 'bg-amber-50 border-amber-200'
      : 'bg-red-50 border-red-200';

  const strokeColor =
    level === 'very-high' || level === 'high'
      ? '#16a34a'
      : level === 'moderate'
      ? '#f59e0b'
      : '#f87171';

  // SVG arc for the gauge
  const radius = 28;
  const circumference = Math.PI * radius; // Half circle
  const filled = (score / 100) * circumference;

  return (
    <div className={`relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 ${bgColor}`}>
      <svg className="absolute inset-0" viewBox="0 0 64 64">
        <path
          d="M 8 44 A 28 28 0 1 1 56 44"
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M 8 44 A 28 28 0 1 1 56 44"
          fill="none"
          stroke={strokeColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <span className={`text-xl font-extrabold ${color}`}>{score}</span>
    </div>
  );
}
